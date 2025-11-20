FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build client bundle
RUN bun run build

# Production stage
FROM oven/bun:1

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install production dependencies
RUN bun install --frozen-lockfile --production

# Copy built dist folder and source files
COPY --from=builder /app/dist ./dist
COPY src ./src
COPY bunfig.toml ./

# Expose port (adjust if your server uses a different port)
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Start the server
CMD ["bun", "run", "start"]
