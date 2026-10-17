# syntax=docker/dockerfile:1
# nginx of a self-hosted install (ADR 0007): the apps' own tenant server
# blocks (assemble.sh) and the web apps built for this domain. Context:
# deploy/self-hosted/nginx; named contexts (compose additional_contexts):
#   auth-src, localman-src, chat-src  the three checkouts
#   localman-app, chat-app            the built app images (web and CSP)

FROM alpine:3.22 AS config
ARG DOMAIN
RUN apk add --no-cache bash
COPY --from=auth-src infra/nginx /src/auth/infra/nginx
COPY --from=localman-src infra/localman/nginx /src/localman/infra/localman/nginx
COPY --from=localman-src infra/tunelo/nginx-tenants.conf /src/localman/infra/tunelo/nginx-tenants.conf
COPY --from=chat-src infra/chat/nginx /src/chat/infra/chat/nginx
COPY --from=chat-src infra/chat/render-tenants-nginx.sh /src/chat/infra/chat/render-tenants-nginx.sh
COPY --from=localman-app /app/csp-script-hashes /src/csp-script-hashes
COPY assemble.sh localman-internal.inc /assemble/
RUN bash /assemble/assemble.sh /src/auth /src/localman /src/chat /src/csp-script-hashes "$DOMAIN" /out

FROM nginx:1.27-alpine AS runtime
# The images' default site would answer any Host on port 80.
RUN rm /etc/nginx/conf.d/default.conf \
	&& mkdir -p /var/lib/hoandat-tenant-acme /etc/letsencrypt-tenants/live
COPY selfhosted-http.conf /etc/nginx/conf.d/00-selfhosted-http.conf
COPY --from=config /out/conf.d/ /etc/nginx/conf.d/
COPY --from=config /out/localman/ /etc/nginx/localman/
# Where the apps' server blocks look for their web apps.
COPY --from=localman-app /app/web /opt/localman/current/web
COPY --from=chat-app /app/web /opt/chat/current/web
COPY reload-on-renewal.sh /docker-entrypoint.d/90-reload-on-renewal.sh
