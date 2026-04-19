# --- Build stage ---
FROM node:25.9.0-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- Production stage ---
FROM node:25.9.0-alpine AS runtime

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server and built frontend
COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 3000
CMD ["node", "server/index.js"]
