# Stage 1: Install dependencies and build
FROM ghcr.io/puppeteer/puppeteer:24.40.0 AS build

USER root
WORKDIR /cloudrun-pdf

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production dependencies only
FROM ghcr.io/puppeteer/puppeteer:24.40.0 AS deps

USER root
WORKDIR /cloudrun-pdf

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM ghcr.io/puppeteer/puppeteer:24.40.0

USER root
WORKDIR /cloudrun-pdf

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV HOME=/tmp

# Copy dependencies from deps stage and compiled output from build stage
COPY --from=deps /cloudrun-pdf/node_modules ./node_modules
COPY --from=build /cloudrun-pdf/dist ./dist

# Change ownership of the working directory to pptruser
RUN chown -R pptruser:pptruser /cloudrun-pdf

# Cloud Run uses PORT environment variable
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

# Run as non-root user (puppeteer image already has pptruser)
USER pptruser

# Start the server
CMD ["node", "dist/index.js"]
