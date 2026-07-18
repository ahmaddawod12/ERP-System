FROM node:22-slim AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/api-contracts ./packages/api-contracts
COPY cloudrun-email ./cloudrun-email

RUN npm --prefix packages/contracts ci \
 && npm --prefix packages/contracts run build \
 && npm --prefix packages/api-contracts ci \
 && npm --prefix packages/api-contracts run build \
 && npm --prefix cloudrun-email ci \
 && npm --prefix cloudrun-email run build

FROM node:22-slim AS production-dependencies

WORKDIR /workspace

COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/api-contracts ./packages/api-contracts
COPY cloudrun-email/package*.json ./cloudrun-email/

RUN npm --prefix cloudrun-email ci --omit=dev \
 && npm cache clean --force

FROM node:22-slim AS runtime

WORKDIR /workspace/cloudrun-email

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV HOME=/tmp

COPY --from=production-dependencies /workspace/packages /workspace/packages
COPY --from=production-dependencies /workspace/cloudrun-email/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-email/dist ./dist
COPY --from=build /workspace/cloudrun-email/package.json ./package.json

USER node

CMD ["node", "dist/src/server.js"]
