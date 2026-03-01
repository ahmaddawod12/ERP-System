# Use the official Puppeteer image with Node.js 22 support
FROM ghcr.io/puppeteer/puppeteer:24.2.1

# Switch to root user for installation
USER root

# Set working directory
WORKDIR /cloudrun-pdf

# Skip downloading Chrome - use the one bundled with the Docker image
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copy package files
COPY package*.json ./

# Install dependencies as root
RUN npm ci --only=production

# Copy application code
COPY . .

# Change ownership of the working directory to pptruser
RUN chown -R pptruser:pptruser /cloudrun-pdf

# Cloud Run uses PORT environment variable
ENV PORT=8080

# Run as non-root user (puppeteer image already has pptruser)
USER pptruser

# Start the server
CMD ["node", "index.js"]
