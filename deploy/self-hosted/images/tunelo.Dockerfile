# syntax=docker/dockerfile:1
# Tunelo relay and web console for a self-hosted install (ADR 0007).
# Context: a checkout of localman-next. scripts/tunelo/build-server.ts
# bundles the workspace packages into server.mjs and writes a package.json
# of the npm dependencies only.

FROM node:22-alpine AS build
RUN npm install --global pnpm@11.9.0 && npm cache clean --force
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build:tunelo-server
WORKDIR /src/dist/tunelo-server
RUN pnpm install --prod --ignore-scripts

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
	TUNNEL_HOST=127.0.0.1 \
	TUNNEL_PORT=3001
WORKDIR /app
COPY --from=build /src/dist/tunelo-server ./
USER node
EXPOSE 3001
CMD ["node", "server.mjs"]
