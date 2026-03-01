# Use Node.js 22 LTS
FROM node:22-slim

WORKDIR /cloudrun-archiver

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Run as non-root user for security
USER node

# Cloud Run Jobs use CMD, not ENTRYPOINT
CMD ["node", "index.js"]
