# Stage 1: Install dependencies
FROM node:22-slim AS deps

WORKDIR /cloudrun-archiver

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Production image
FROM node:22-slim

WORKDIR /cloudrun-archiver

ENV HOME=/tmp

# Copy dependencies from build stage
COPY --from=deps /cloudrun-archiver/node_modules ./node_modules

# Copy source code
COPY . .

# Run as non-root user for security
USER node

# Cloud Run Jobs use CMD, not ENTRYPOINT
CMD ["node", "index.js"]
