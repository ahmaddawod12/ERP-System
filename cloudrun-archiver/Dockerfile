# Stage 1: Build
FROM node:22-slim AS build

WORKDIR /cloudrun-archiver

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production dependencies only
FROM node:22-slim AS deps

WORKDIR /cloudrun-archiver

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:22-slim

WORKDIR /cloudrun-archiver

ENV HOME=/tmp

# Copy dependencies from build stage
COPY --from=deps /cloudrun-archiver/node_modules ./node_modules

# Copy production deps and compiled source
COPY --from=build /cloudrun-archiver/dist ./dist

# Run as non-root user for security
USER node

# Cloud Run Jobs use CMD, not ENTRYPOINT
CMD ["node", "dist/index.js"]
