#!/usr/bin/env node
'use strict'

const config = require("config");
const env = process.env.NODE_ENV || 'development'
const logger = require('pino')()

var COUCHDB_OK = false, POSTGRESQL_OK = false;

//CouchDB setup
const nano = require('nano')(config.get('couchDB.url'))
let db = nano.use(config.get('couchDB.dbname'));
const { Writable, Transform } = require("stream");

//retry mechnanism in case of error
const retry = async (fn, maxAttempts) => {
  const execute = async (attempt) => {
    try {
        return await fn()
    } catch (err) {
        if (attempt <= maxAttempts) {
            const nextAttempt = attempt + 1
            const delayInSeconds = Math.max(Math.min(Math.pow(2, nextAttempt) + randInt(-nextAttempt, nextAttempt), 600), 1)
            logger.error(`Retrying after ${delayInSeconds} seconds due to: ${err}`)
            return delay(() => execute(nextAttempt), delayInSeconds * 1000)
        } else {
            throw err
        }
    }
  }
  return execute(1)
}
const delay = (fn, ms) => new Promise((resolve) => setTimeout(() => resolve(fn()), ms))
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1) + min)

//Check if the connection to CouchDB is ok
//Check if the database exists and if does not the create it
async function checkCouchDB() {
  try {
    const dbcheck = await db.info()
    //logger.info(dbcheck)
    COUCHDB_OK = true;
    return true;
  } catch (error) {
    logger.error(error);
    //Set retry mechanism if server is not running
    if (error.message.indexOf("ECONNREFUSED") != -1) logger.error(error);

    //Create DB if does not exists
    if (typeof error.statusCode !== 'undefined') {
      if (error.statusCode == '404') {
        //Database does not exists in CouchDB - create it
        nano.db.create(config.get('couchDB.dbname'), { n: 1 }, function (err, data) {
          if (err) {
            logger.info(err);
          } else {
            logger.info(data);
            COUCHDB_OK = true;
            return true;
          }
        })
      }
    }
    throw error;

  }
}

//PostgreSQL setup
const { Pool } = require('pg')
const connectionString = config.get('postgresql.uri')
const pool = new Pool({
  connectionString,
})
const pgtable = config.get('postgresql.table');

//Check if the connection to PostgreSQL is ok
//Check if the table exists and if not create it
async function checkPostgreSQL() {
  try {
    const client = await pool.connect()
    const checkdb = await client.query(`SELECT * FROM ${pgtable} LIMIT 1;`)
    client.release()
    POSTGRESQL_OK = true;
    return true;
  } catch (error) {
    logger.error(error)
    //PostgreSQL connection is not ok
    if (error.message.indexOf("ECONNREFUSED") != -1) logger.error(error);
    //Create DB if does not exists
    if (typeof error.code !== 'undefined') {
      if (error.code == '42P01') {
        //Database does not exists in PostgreSQL - create it
        let sqlstring = `CREATE TABLE ${pgtable} (id text, doc jsonb, CONSTRAINT ${pgtable}_pkey PRIMARY KEY (id) );`;
        pool.query(sqlstring, function (err, data) {
          logger.info(sqlstring);
          if (err) {
            logger.error(err);
          } else {
            logger.info(data);
            POSTGRESQL_OK = true;
            return true;
          }
        });
      }
    }
    throw error;
  }
}


const lineSplitter = () =>
  new Transform({
    objectMode: true,
    transform(chunk, encoding, callback) {
      let raw = Buffer.from(chunk, encoding).toString();
      if (this._leftOver) {
        raw = this._leftOver + raw;
      }
      let lines = raw.split("\n");
      this._leftOver = lines.splice(lines.length - 1, 1)[0];
      for (var i in lines) {
        this.push(lines[i]);
      }
      callback();
    },
    flush(callback) {
      if (this._leftOver) {
        this.push(this._leftOver);
      }
      this._leftOver = null;
      callback();
    },
  });


const jsonMaker = () =>
  new Transform({
    objectMode: true,
    transform(rawLine, encoding, callback) {
      // remove the comma at the end of the line - CouchDB sent an array
      let line = rawLine.toString().replace(/,$/m, "").trim();
      if (line.startsWith('{"id":') && line.endsWith("}")) {
        try {
          let j = JSON.parse(line);
          // We only want the document
          if (j.doc) {
            this.push(JSON.stringify(j.doc));
          }
        } catch (e) {
          logger.error(e.message);
          //console.error(e.message);
        }
      }
      callback();
    },
  });

const documentWriter = (resultCallback) =>
  new Writable({
    write(chunk, encoding, callback) {
      let json = JSON.parse(Buffer.from(chunk, encoding).toString());
      // Process the code
      resultCallback(json);
      // Tell that we are done
      callback();
    },
  });

//Once a document is parsed from the steam we get it here
function resultCallback(params) {
  logger.info(params)
  //console.log(params)
  var sqlstring = `INSERT INTO  ${pgtable} (id, doc) VALUES('${params._id}','${JSON.stringify(params)}') 
    ON CONFLICT (id) 
    DO UPDATE SET doc = '${JSON.stringify(params)}';`
  logger.info(sqlstring)
  //console.log(sqlstring)
  //UPSERT the document into PostgreSQL
  pool.query(sqlstring, (err, res) => {
    if (err) {
      logger.error(err)
    } else {
      logger.info(res)
    }
  })
}

//Stream all the documents from CouchDB - one time initial sync
async function oneTimeSync() {
  if (COUCHDB_OK == true && POSTGRESQL_OK == true) {
    logger.info("Starting the initial one time sync")
    db.listAsStream({ include_docs: true })
      .on("error", (e) => logger.error(e))
      .pipe(lineSplitter())
      .pipe(jsonMaker())
      .pipe(documentWriter(resultCallback));
    logger.info("DONE >>> one time sync")

  }
}

//Listen to change feed
async function continousSync() {
  try {
    logger.info("Starting continuous sync")

    db.changesReader.start({ includeDocs: true })
      .on('change', (c) => {
        logger.info(c.doc);
        resultCallback(c.doc);
      }).on('seq', (s) => {
        logger.info('sequence token', s);
      }).on('error', (e) => {
        logger.error(e);
      }).on('end', (count) => {
        logger.info('changes feed monitoring has stopped', count);
      });
  } catch (error) {
    logger.error(error)
    pool.end()
  }

}
//Main loop
(async function () {
  try {
    const ckCouchDB = await retry(checkCouchDB, 7), 
          ckPostgreSQL = await retry(checkPostgreSQL, 7), 
          ots = await oneTimeSync(),
          forever = await continousSync();
  } catch (error) {
    logger.error(error)
  }
})()
