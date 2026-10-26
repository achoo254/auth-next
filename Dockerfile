# syntax=docker/dockerfile:1

# ---- base: Node 22 LTS with the pinned pnpm --------------------------------
FROM node:22-alpine AS base
# The test-only mongodb-memory-server must not download mongod in images.
ENV MONGOMS_DISABLE_POSTINSTALL=1
RUN npm install --global pnpm@11.9.0 && npm cache clean --force
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# ---- build: compile the server bundle --------------------------------------
FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.json brand.config.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build

# ---- prod-deps: runtime dependencies only ----------------------------------
FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: non-root, no build tooling ------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=4500
WORKDIR /app
# Files stay root-owned so the service user cannot modify its own code.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Stylesheets served under /assets; fonts come from @fontsource in node_modules.
COPY static ./static
# Favicon, app icons and web manifest (src/brand-install.ts, pnpm brand:gen).
COPY brand ./brand
COPY package.json ./
USER node
EXPOSE 4500
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4500) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.mjs"]
