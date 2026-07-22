FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/db ./packages/db

RUN npm --prefix packages/contracts ci \
 && npm --prefix packages/contracts run build \
 && npm --prefix packages/db ci \
 && npm --prefix packages/db run build \
 && npm --prefix packages/contracts prune --omit=dev \
 && npm --prefix packages/db prune --omit=dev \
 && npm cache clean --force

FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d

WORKDIR /workspace/packages/db

ENV NODE_ENV=production
ENV HOME=/tmp

RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* \
            /usr/local/lib/node_modules/npm \
            /usr/local/bin/npm \
            /usr/local/bin/npx

# Only production database dependencies and checked-in SQL are retained. No
# runtime service receives the migrator credential or development toolchain.
COPY --from=build /workspace/packages/contracts /workspace/packages/contracts
COPY --from=build /workspace/packages/db/package.json ./package.json
COPY --from=build /workspace/packages/db/migrations ./migrations
COPY --from=build /workspace/packages/db/node_modules ./node_modules
COPY cloudrun-migrations/migrate.mjs ./migrate.mjs
COPY cloudrun-migrations/smoke.mjs ./smoke.mjs

USER node

CMD ["node", "migrate.mjs"]
