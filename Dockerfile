FROM node:18-alpine3.15

# Parameters supplied at build time
# see image.sh for details
ARG BUILD_DATE
ARG GIT_REF
ARG BUILD_VERSION
ARG IMG_NAME


LABEL org.opencontainers.image.created="$BUILD_DATE" \
      org.opencontainers.image.title="$IMG_NAME" \
      org.opencontainers.image.description="CouchDB database export to PostgreSQL" \
      org.opencontainers.image.vendor="DataStema" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.source="https://github.com/DataStema/couch-export" \
      org.opencontainers.image.revision="$GIT_REF" \
      org.opencontainers.image.url="https://datastema.io/" \
      org.opencontainers.image.authors="contact@datastema.io"

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