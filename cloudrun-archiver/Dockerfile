# Stage 1: Build shared packages and archiver
FROM node:22-slim AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/db ./packages/db
COPY cloudrun-archiver ./cloudrun-archiver

RUN npm --prefix packages/contracts ci
RUN npm --prefix packages/contracts run build
RUN npm --prefix packages/db ci
RUN npm --prefix packages/db run build
RUN npm --prefix cloudrun-archiver ci
RUN npm --prefix cloudrun-archiver run build

# Stage 2: Production dependencies only
FROM node:22-slim AS deps

WORKDIR /workspace

COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/db ./packages/db
COPY --from=build /workspace/cloudrun-archiver/package*.json ./cloudrun-archiver/

RUN npm --prefix cloudrun-archiver ci --omit=dev

# Stage 3: Production image
FROM node:22-slim

WORKDIR /cloudrun-archiver

ENV HOME=/tmp

COPY --from=deps /workspace/cloudrun-archiver/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-archiver/dist ./dist

USER node

CMD ["node", "dist/index.js"]
