FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS build

WORKDIR /workspace

COPY packages/contracts ./packages/contracts
COPY packages/api-contracts ./packages/api-contracts
COPY website ./website

RUN npm --prefix packages/contracts ci \
 && npm --prefix packages/contracts run build \
 && npm --prefix packages/api-contracts ci \
 && npm --prefix packages/api-contracts run build \
 && npm --prefix website ci \
 && npm --prefix website run build

FROM node:22.22.1-slim@sha256:4f77a690f2f8946ab16fe1e791a3ac0667ae1c3575c3e4d0d4589e9ed5bfaf3d AS runtime

WORKDIR /workspace/website

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV HOME=/tmp

RUN apt-get update \
 && apt-get upgrade -y \
 && rm -rf /var/lib/apt/lists/* \
            /usr/local/lib/node_modules/npm \
            /usr/local/bin/npm \
            /usr/local/bin/npx

COPY --from=build --chown=node:node /workspace/website/.next/standalone /workspace
COPY --from=build --chown=node:node /workspace/website/.next/static ./.next/static
COPY --from=build --chown=node:node /workspace/website/public ./public
COPY --from=build --chown=node:node /workspace/website/docker-entrypoint.mjs ./docker-entrypoint.mjs

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/healthz').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "docker-entrypoint.mjs"]
