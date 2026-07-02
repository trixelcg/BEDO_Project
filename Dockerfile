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

# Copy built assets and backend
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/api ./api
COPY --from=builder /app/server.ts ./server.ts

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

# Start the node server running the TypeScript wrapper
CMD ["tsx", "server.ts"]
