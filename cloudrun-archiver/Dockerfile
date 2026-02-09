# Use Node.js LTS
FROM node:18-slim

WORKDIR /cloudrun-archiver

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Cloud Run Jobs use CMD, not ENTRYPOINT
CMD ["node", "index.js"]
