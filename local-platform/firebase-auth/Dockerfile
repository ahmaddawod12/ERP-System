FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d

RUN npm install --global --omit=dev firebase-tools@15.4.0 \
    && npm cache clean --force

WORKDIR /app
COPY firebase.json ./

EXPOSE 9099
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "smart-job-local", "--config", "/app/firebase.json", "--import", "/data", "--export-on-exit", "/data"]
