# Stage 1: Install dependencies
FROM ghcr.io/puppeteer/puppeteer:24.2.1 AS deps

USER root
WORKDIR /cloudrun-pdf

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --only=production

# Stage 2: Production image
FROM ghcr.io/puppeteer/puppeteer:24.2.1

USER root
WORKDIR /cloudrun-pdf

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ENV HOME=/tmp

# Copy dependencies from build stage (leverages Docker layer caching)
COPY --from=deps /cloudrun-pdf/node_modules ./node_modules

# Copy application code
COPY . .

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
CMD ["node", "index.js"]
