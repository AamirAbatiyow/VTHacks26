# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build

WORKDIR /app

# The Fly build context is the repository root, while the deployable npm
# workspace lives in conversational-ai/.
COPY conversational-ai/package.json conversational-ai/package-lock.json ./
COPY conversational-ai/server/package.json server/package.json
COPY conversational-ai/client/package.json client/package.json

RUN npm ci

COPY conversational-ai/server server
COPY conversational-ai/client client
COPY conversational-ai/shared shared

RUN npm run build \
  && npm prune --omit=dev


FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    ANALYTICS_DB_PATH=/data/analytics.sqlite

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/models ./server/models
COPY --from=build --chown=node:node /app/server/certs ./server/certs
COPY --from=build --chown=node:node /app/client/dist ./client/dist

# /data is only a writable fallback when DATABASE_URL is absent. Fly should use
# Tiger/Timescale in production; the container filesystem is otherwise ephemeral.
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server/src/index.js"]
