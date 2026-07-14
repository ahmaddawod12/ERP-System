FROM node:22-slim AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/api-contracts ./packages/api-contracts
COPY cloudrun-tax ./cloudrun-tax

RUN npm --prefix packages/contracts ci \
 && npm --prefix packages/contracts run build \
 && npm --prefix packages/api-contracts ci \
 && npm --prefix packages/api-contracts run build \
 && npm --prefix cloudrun-tax ci \
 && npm --prefix cloudrun-tax run build

FROM node:22-slim AS production-dependencies

WORKDIR /workspace

COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/api-contracts ./packages/api-contracts
COPY cloudrun-tax/package*.json ./cloudrun-tax/

RUN npm --prefix cloudrun-tax ci --omit=dev \
 && npm cache clean --force

FROM node:22-slim AS runtime

WORKDIR /workspace/cloudrun-tax

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV HOME=/tmp

COPY --from=production-dependencies /workspace/packages /workspace/packages
COPY --from=production-dependencies /workspace/cloudrun-tax/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-tax/dist ./dist
COPY --from=build /workspace/cloudrun-tax/package.json ./package.json

USER node

CMD ["node", "dist/src/server.js"]
