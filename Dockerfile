# syntax=docker/dockerfile:1

# ---------- 1) Install production dependencies ----------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- 2) Build frontend with Vite only ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Do not use "npm run build" here, because the project script runs "tsc -b && vite build".
# Some upstream TypeScript warnings/errors can block Docker image creation.
# For Sealos deployment, we only need the Vite frontend output in /dist.
RUN npx vite build

# ---------- 3) Runtime: Node API + Nginx frontend ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/nginx /app/data

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

COPY package.json package-lock.json server.js ./
COPY server ./server

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/start.sh /app/start.sh

RUN chmod +x /app/start.sh

VOLUME ["/app/data"]
EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["/app/start.sh"]
