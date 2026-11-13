# Kearns Mining Rig backend — Fly.io image
FROM node:20-alpine

WORKDIR /app

# Install dependencies first (better layer caching)
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the app code
COPY backend/ ./

# Data lives on the Fly volume mounted at /data (see fly.toml [[mounts]]).
# The server reads DATA_FILE env var, defaulting to ./data.json.
ENV NODE_ENV=production
ENV PORT=5000
ENV DATA_FILE=/data/data.json

EXPOSE 5000

CMD ["node", "server.js"]
