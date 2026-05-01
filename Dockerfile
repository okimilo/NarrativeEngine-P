# syntax=docker/dockerfile:1

# ---------- 1) Install production dependencies with native modules ----------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

# better-sqlite3 / sqlite-vec may need native build tools during npm install.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- 2) Build the Vite frontend ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 3) Runtime: Node API + Nginx static frontend/proxy ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends nginx tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /run/nginx /app/data

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV PORT=8080

# App runtime files
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json package-lock.json server.js ./
COPY server ./server

# Nginx + startup script
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

VOLUME ["/app/data"]
EXPOSE 8080

ENTRYPOINT ["tini", "--"]
CMD ["/app/start.sh"]
