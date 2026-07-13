# Stage 1: Install dependencies and build shared packages + service
FROM ghcr.io/puppeteer/puppeteer:24.40.0 AS build

USER root
WORKDIR /workspace

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY packages/contracts ./packages/contracts
COPY cloudrun-pdf/package*.json ./cloudrun-pdf/

RUN npm --prefix packages/contracts ci
RUN npm --prefix packages/contracts run build
RUN npm --prefix cloudrun-pdf ci

COPY cloudrun-pdf ./cloudrun-pdf
RUN npm --prefix cloudrun-pdf run build

# Stage 2: Production dependencies only
FROM ghcr.io/puppeteer/puppeteer:24.40.0 AS deps

USER root
WORKDIR /workspace

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Copy the built contracts package so the file: symlink stays valid.
COPY --from=build /workspace/packages/contracts ./packages/contracts
COPY cloudrun-pdf/package*.json ./cloudrun-pdf/

RUN npm --prefix cloudrun-pdf ci --omit=dev

# Stage 3: Production image
FROM ghcr.io/puppeteer/puppeteer:24.40.0

USER root

# Preserve the /workspace layout so the file: symlink to @smart-job/contracts remains valid.
WORKDIR /workspace/cloudrun-pdf

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV HOME=/tmp

COPY --from=deps /workspace/packages /workspace/packages
COPY --from=deps /workspace/cloudrun-pdf/node_modules ./node_modules
COPY --from=build /workspace/cloudrun-pdf/dist ./dist

RUN chown -R pptruser:pptruser /workspace/cloudrun-pdf

# Cloud Run uses PORT environment variable
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Run as non-root user (puppeteer image already has pptruser)
USER pptruser

# Start the server
CMD ["node", "dist/index.js"]
