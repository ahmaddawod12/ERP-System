FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build

WORKDIR /workspace
COPY packages/observability ./packages/observability
COPY cloudrun-backup ./cloudrun-backup
RUN npm --prefix packages/observability ci \
 && npm --prefix packages/observability run build \
 && npm --prefix cloudrun-backup ci \
 && npm --prefix cloudrun-backup run build \
 && npm --prefix packages/observability prune --omit=dev \
 && npm --prefix cloudrun-backup prune --omit=dev

FROM postgres:17-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394

ENV HOME=/tmp
WORKDIR /workspace/cloudrun-backup

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /workspace/cloudrun-backup/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-backup/dist ./dist
COPY --from=build /workspace/packages/observability /workspace/packages/observability

# The inherited entrypoint does not need gosu because this image always runs as postgres.
RUN rm /usr/local/bin/gosu

USER postgres
CMD ["node", "--import", "@smart-job/observability/register", "dist/index.js"]
