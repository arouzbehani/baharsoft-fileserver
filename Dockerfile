# syntax=docker/dockerfile:1

FROM node:22-trixie-slim AS admin-build
WORKDIR /build/admin-ui
COPY admin-ui/package.json admin-ui/package-lock.json ./
RUN npm ci
COPY admin-ui/ ./
RUN npm run build

FROM node:22-trixie-slim AS api-dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-trixie-slim AS runtime
ARG VERSION=1.0.0
LABEL org.opencontainers.image.title="Baharsoft File Server" \
      org.opencontainers.image.description="Generic multi-tenant file storage service" \
      org.opencontainers.image.source="https://github.com/arouzbehani/baharsoft-fileserver" \
      org.opencontainers.image.version="${VERSION}"

ENV NODE_ENV=production \
    PORT=3000 \
    FILESERVER_VERSION=${VERSION} \
    FILESERVER_DATA_ROOT=/var/lib/fileserver/data \
    FILESERVER_DB_PATH=/var/lib/fileserver/data/fileserver.sqlite \
    FILESERVER_STORAGE_ROOT=/var/lib/fileserver/storage/tenants \
    FILESERVER_QUARANTINE_ROOT=/var/lib/fileserver/quarantine

WORKDIR /app
COPY --from=api-dependencies /build/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY scripts ./scripts
COPY --from=admin-build /build/admin-ui/dist ./admin-ui/dist

RUN mkdir -p \
      /var/lib/fileserver/data \
      /var/lib/fileserver/storage/tenants \
      /var/lib/fileserver/quarantine \
    && chown -R node:node /app /var/lib/fileserver

USER node
EXPOSE 3000
VOLUME ["/var/lib/fileserver/data", "/var/lib/fileserver/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "scripts/healthcheck.js"]

CMD ["node", "src/server.js"]
