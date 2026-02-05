# --- Build stage ---
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:20-alpine AS runtime

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --production

# Copy server and built frontend
COPY --from=build /app/dist ./dist
COPY server ./server
COPY config ./config

EXPOSE 3000
CMD ["node", "server/index.js"]
