# Stage 0: Keep the PDF build and runtime on the repository's Node 22 contract.
FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS node22-runtime

# Stage 1: Install dependencies and build shared packages + service
FROM ghcr.io/puppeteer/puppeteer:24.40.0@sha256:de1c985f0af848b07599cdb20ec0509b1a69927cf466b65cf56eb706cc4245fb AS build

USER root
WORKDIR /workspace

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY --from=node22-runtime /usr/local/bin/node /usr/local/bin/node
COPY packages/contracts ./packages/contracts
COPY packages/api-contracts ./packages/api-contracts
COPY packages/observability ./packages/observability
COPY cloudrun-pdf/package*.json ./cloudrun-pdf/

RUN npm --prefix packages/contracts ci
RUN npm --prefix packages/contracts run build
RUN npm --prefix packages/api-contracts ci
RUN npm --prefix packages/api-contracts run build
RUN npm --prefix packages/observability ci
RUN npm --prefix packages/observability run build
RUN npm --prefix cloudrun-pdf ci

COPY cloudrun-pdf ./cloudrun-pdf
RUN npm --prefix cloudrun-pdf run build

# Stage 2: Production dependencies only
FROM ghcr.io/puppeteer/puppeteer:24.40.0@sha256:de1c985f0af848b07599cdb20ec0509b1a69927cf466b65cf56eb706cc4245fb AS deps

USER root
WORKDIR /workspace

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY --from=node22-runtime /usr/local/bin/node /usr/local/bin/node
# Copy the built contract packages so the file: symlinks stay valid.
COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY --from=build /workspace/packages/api-contracts ./packages/api-contracts
COPY --from=build /workspace/packages/observability ./packages/observability
COPY cloudrun-pdf/package*.json ./cloudrun-pdf/

RUN npm --prefix packages/contracts prune --omit=dev \
 && npm --prefix packages/api-contracts prune --omit=dev \
 && npm --prefix packages/observability prune --omit=dev \
 && npm --prefix cloudrun-pdf ci --omit=dev

# Stage 3: Production image
FROM ghcr.io/puppeteer/puppeteer:24.40.0@sha256:de1c985f0af848b07599cdb20ec0509b1a69927cf466b65cf56eb706cc4245fb

USER root

# Preserve the /workspace layout so the file: symlink to @smart-job/contracts remains valid.
WORKDIR /workspace/cloudrun-pdf

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV HOME=/tmp

COPY --from=node22-runtime /usr/local/bin/node /usr/local/bin/node

RUN chrome_path="$(find /home/pptruser/.cache/puppeteer/chrome -type f -path '*/chrome-linux64/chrome' -print -quit)" \
 && test "$(node --version)" = "v22.22.1" \
 && test -n "$chrome_path" \
 && ln -s "$chrome_path" /usr/bin/google-chrome-stable \
 && test -x /usr/bin/google-chrome-stable \
 && apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* \
            /usr/local/lib/node_modules/npm \
            /usr/local/bin/npm \
            /usr/local/bin/npx \
            /home/pptruser/node_modules \
            /home/pptruser/package.json \
            /home/pptruser/package-lock.json

COPY --from=deps --chown=pptruser:pptruser /workspace/packages /workspace/packages
COPY --from=deps --chown=pptruser:pptruser /workspace/cloudrun-pdf/node_modules ./node_modules
COPY --from=build --chown=pptruser:pptruser /workspace/cloudrun-pdf/dist ./dist

# Cloud Run uses PORT environment variable
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Run as non-root user (puppeteer image already has pptruser)
USER pptruser

# Start the server
CMD ["node", "--import", "@smart-job/observability/register", "dist/index.js"]
