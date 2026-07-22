# Stage 1: Build shared packages and archiver
FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build

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
FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS deps

WORKDIR /workspace

COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/db ./packages/db
COPY --from=build /workspace/cloudrun-archiver/package*.json ./cloudrun-archiver/

RUN npm --prefix packages/contracts prune --omit=dev \
 && npm --prefix packages/db prune --omit=dev \
 && npm --prefix cloudrun-archiver ci --omit=dev \
 && npm cache clean --force

# Stage 3: Production image
FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d

# Preserve the /workspace layout so the file: symlink to @smart-job/db remains valid.
WORKDIR /workspace/cloudrun-archiver

ENV HOME=/tmp

COPY --from=deps /workspace/packages /workspace/packages
COPY --from=deps /workspace/cloudrun-archiver/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-archiver/dist ./dist

USER node

CMD ["node", "dist/index.js"]
