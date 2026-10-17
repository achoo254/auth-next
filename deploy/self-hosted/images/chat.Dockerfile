# syntax=docker/dockerfile:1
# Chat (Go API with realtime and bots, and the web app nginx serves) for a
# self-hosted install (ADR 0007). Context: a checkout of chat-next. The web
# app reads brand.config.json at build time, whose primary tenant becomes
# this install's domain; app ids and the URL scheme stay, so one mobile and
# desktop app serves every tenant. `pnpm brand:gen` is not run: what it
# writes (icons, manifests, the server's names) does not depend on the
# domain and is committed, and it needs a browser to draw the icons.

FROM node:22-alpine AS web
ARG DOMAIN
RUN test -n "$DOMAIN" && npm install --global pnpm@11.9.0 && npm cache clean --force
WORKDIR /src
COPY . .
RUN node -e ' \
	const fs = require("node:fs"); \
	const brand = JSON.parse(fs.readFileSync("brand.config.json", "utf8")); \
	brand.primaryTenant = { domain: process.env.DOMAIN, issuer: `https://auth.${process.env.DOMAIN}` }; \
	fs.writeFileSync("brand.config.json", `${JSON.stringify(brand, null, 2)}\n`);' \
	&& pnpm install --frozen-lockfile \
	&& pnpm --filter @app/web build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY --from=web /src/server ./server
RUN cd server && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/server ./cmd/server

FROM alpine:3.22 AS runtime
RUN adduser -D -H -u 10001 chat
COPY --from=server /out/server /app/server
# Served by nginx, which copies it from this image.
COPY --from=web /src/apps/web/dist /app/web
USER chat
# Loopback of nginx's network namespace: chat trusts X-Real-IP from a
# loopback peer only, as on the shared host.
ENV CHAT_ENV=production \
	CHAT_LISTEN_ADDR=127.0.0.1:4600
EXPOSE 4600
ENTRYPOINT ["/app/server"]
CMD ["-role", "api"]
