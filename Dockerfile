# ============================================================================
# Stage 1: Build & Compilation Stage
# ============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

# Install build dependencies
COPY package*.json ./
COPY tsconfig*.json ./
COPY prisma ./prisma/

RUN npm ci

# Copy source code and docs
COPY src ./src

# Generate Prisma Client and compile TypeScript
RUN npx prisma generate
RUN npm run build

# ============================================================================
# Stage 2: Minimal Production Runtime
# ============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev
RUN npx prisma generate

# Copy compiled JavaScript and Swagger documentation
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/docs ./src/docs
COPY --from=builder /app/src/docs ./dist/docs

# Copy container startup script
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
