FROM node:22-slim AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/api-contracts ./packages/api-contracts
COPY packages/db ./packages/db
COPY cloudrun-api ./cloudrun-api

RUN npm --prefix packages/contracts ci \
 && npm --prefix packages/contracts run build \
 && npm --prefix packages/api-contracts ci \
 && npm --prefix packages/api-contracts run build \
 && npm --prefix packages/db ci \
 && npm --prefix packages/db run build \
 && npm --prefix cloudrun-api ci \
 && npm --prefix cloudrun-api run build

FROM node:22-slim AS production-dependencies

WORKDIR /workspace

COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/api-contracts ./packages/api-contracts
COPY --from=build /workspace/packages/db ./packages/db
COPY cloudrun-api/package*.json ./cloudrun-api/

RUN npm --prefix cloudrun-api ci --omit=dev \
 && npm cache clean --force

FROM node:22-slim AS runtime

WORKDIR /workspace/cloudrun-api

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV HOME=/tmp

COPY --from=production-dependencies /workspace/packages /workspace/packages
COPY --from=production-dependencies /workspace/cloudrun-api/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-api/dist ./dist
COPY --from=build /workspace/cloudrun-api/package.json ./package.json

USER node

CMD ["node", "dist/server.js"]
