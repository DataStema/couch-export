#!/usr/bin/env node
'use strict'

const config = require("config");
const env = process.env.NODE_ENV || 'development'
const logger = require('pino')()



//CouchDB setup
const nano = require('nano')(config.get('couchDB.url'))
const db = nano.use(config.get('couchDB.dbname'));
const { Writable, Transform } = require("stream");


//TODO - check if the connection to CouchDB is ok
//TODO - check if the database exists

//PostgreSQL setup
const { Pool } = require('pg')
const connectionString = config.get('postgresql.uri')
const pool = new Pool({
  connectionString,
})

//TODO - check if the connection to PostgreSQL is ok
//TODO - check if the table exists and if not create it
const pgtable = config.get('postgresql.table')
/*
;(async function() {
    const client = await pool.connect()
    await client.query('SELECT NOW()')
    client.release()
  })()
*/

/*
//Testing
pool.query('SELECT NOW()', (err, res) => {
  console.log(err, res)
  pool.end()
})
*/

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
        if(err){
            logger.error(err)
        }else{
            logger.info(res)
        }
        //console.log(err, res)
        pool.end()
      })
}

//Stream all the documents from CouchDB
db.listAsStream({ include_docs: true })
.on("error", (e) => logger.error(e))
.pipe(lineSplitter())
.pipe(jsonMaker())
.pipe(documentWriter(resultCallback));

//console.error("error", e)
//Cleanup PostgreSQL connection
//pool.end()


