# --- Base Node stage ---
FROM node:25.9.0-alpine AS node-base

# --- Stripped Node runtime stage ---
FROM node-base AS node-runtime

RUN cp /usr/local/bin/node /tmp/node \
  && apk add --no-cache binutils \
  && strip --strip-all /tmp/node

# --- Build stage ---
FROM node-base AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY index.html svelte.config.js vite.config.js jsconfig.json ./
COPY src ./src
RUN npm run build

# --- Production dependencies stage ---
FROM node-base AS prod-deps

ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

# --- Minimal runtime stage ---
FROM alpine:3.22 AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Copy only the Node runtime bits needed by the app. npm is intentionally omitted.
COPY --from=node-runtime /tmp/node /usr/local/bin/node
COPY --from=node-base /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=node-base /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=node-base /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs \
  && mkdir -p cache/art config \
  && chown -R nodejs:nodejs /app

COPY --from=prod-deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --chown=nodejs:nodejs server ./server

USER nodejs

EXPOSE 3000
CMD ["node", "server/index.js"]
