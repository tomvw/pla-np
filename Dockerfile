# --- Build stage ---
FROM node:25.9.0-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm cache clean --force

COPY index.html svelte.config.js vite.config.js jsconfig.json ./
COPY src ./src
RUN npm run build

# --- Production stage ---
FROM node:25.9.0-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

# Copy server and built frontend
COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 3000
CMD ["node", "server/index.js"]
