# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.21.0

# ---- build: install dev dependencies and compile TypeScript ----
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime: compiled JavaScript only ----
# DevOps Sentinel has no runtime dependencies, so node_modules is not copied.
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Files stay owned by root and are only readable by the app user, so a
# compromised process cannot modify its own code.
COPY package.json ./
COPY --from=build /app/dist ./dist

# The official image ships an unprivileged "node" user (uid 1000).
USER node

# Healthy and warning (exit 0/1) count as healthy; critical, unknown or a
# crash (exit 2+) count as unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node dist/cli.js --once --log-level silent > /dev/null; [ $? -le 1 ]

# Exec form: node receives SIGTERM directly from `docker stop`.
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--interval", "10"]
