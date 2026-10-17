# syntax=docker/dockerfile:1
# Chat (Go API with realtime and bots, and the web app nginx serves) for a
# self-hosted install (ADR 0007). Context: a checkout of chat-next. The web
# app reads its tenant from chat.<domain> at run time, so the image serves
# any domain; app ids and the URL scheme stay, so one mobile and desktop
# app serves every tenant.

FROM node:22-alpine AS web
RUN npm install --global pnpm@11.9.0 && npm cache clean --force
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile \
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
