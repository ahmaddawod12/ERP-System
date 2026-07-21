FROM node:22.22.1-alpine3.23

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8090
ENV HOME=/tmp

COPY --chown=node:node local-platform/adapter/package.json ./package.json
COPY --chown=node:node local-platform/adapter/app.mjs ./app.mjs
COPY --chown=node:node local-platform/adapter/server.mjs ./server.mjs

# Named volumes are mounted with root ownership on first use. Pre-create the
# mount point with the runtime uid so the non-root process can persist queues.
RUN mkdir -p /data/queue && chown -R node:node /data

USER node

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:8090/readyz').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
