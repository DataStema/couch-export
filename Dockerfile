FROM node:18-alpine3.15

LABEL org.label-schema.author='DataStema'
LABEL org.label-schema.name='datastemalux/couch-export'
LABEL org.label-schema.description='CouchDB export to PostgreSQL'

ENV NODE_ENV=production

RUN mkdir -p /app/node_modules && chown -R node:node /app
WORKDIR /app

COPY package*.json ./

RUN npm install
# If you are building your code for production
RUN npm ci --only=production

COPY --chown=node:node . .

USER node

CMD [ "node", "/app/index.js" ]