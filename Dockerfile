# Production Dockerfile for Google Cloud Run
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency configuration
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy full application code
COPY . .

# Build Vite frontend assets (creates dist/ folder)
RUN npm run build

# Stage 2: Final minimal runner image
FROM node:20-alpine

WORKDIR /app

# Copy packages
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production

# Install tsx globally in the runner image to execute TypeScript files (server.ts) directly
RUN npm install -g tsx

# Copy built assets and the static server.
#
# `dist/` only. Vite already copies everything in `public/` into `dist/`, so copying
# public/ as well put a second identical copy of the 26 MB model and the 28 MB video in
# the image. server.ts looks in public/ first and falls back to dist/, and serving with
# public/ absent was verified to return every production asset with the correct bytes
# (BEDO-004 §9).
#
# No api/ either — BEDO-003 removed the last endpoint, and Docker fails a COPY whose
# source does not exist.
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

# Start the node server running the TypeScript wrapper
CMD ["tsx", "server.ts"]
