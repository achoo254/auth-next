# syntax=docker/dockerfile:1
# Localman (dashboard API + mock runtime, and the web app nginx serves) for a
# self-hosted install (ADR 0007). Context: a checkout of localman-next. The
# web app inlines its IdP origin at build time, so the image is per domain.

FROM node:22-alpine AS build
ARG DOMAIN
RUN test -n "$DOMAIN" && npm install --global pnpm@11.9.0 && npm cache clean --force
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
ENV VITE_API_BASE_URL="" \
	VITE_IDP_ORIGIN="https://auth.${DOMAIN}"
RUN VITE_FEATURES="$(grep -v '^#' infra/localman/released-features | tr -d ' \t' | sed '/^$/d' | paste -sd, -)" \
	pnpm --filter @localman/api --filter @localman/web build
# Runtime dependencies from the workspace lockfile, then the bundle on top
# (the same steps as infra/localman/deploy.sh).
RUN pnpm --filter @localman/api deploy --prod --config.inject-workspace-packages=true /out/api \
	&& cp -R apps/api/dist/. /out/api/ \
	&& cp -R apps/web/dist /out/web \
	&& node infra/localman/csp-hashes.mjs apps/web/dist/*.html > /out/csp-script-hashes

FROM node:22-alpine AS runtime
# Loopback of nginx's network namespace, as on the shared host.
ENV NODE_ENV=production \
	HOST=127.0.0.1 \
	DASHBOARD_PORT=4000 \
	MOCK_PORT=4100
WORKDIR /app
# Root-owned files: the service user cannot change its own code. The nginx
# image copies /app/web and the CSP hashes from this image.
COPY --from=build /out/api ./
COPY --from=build /out/web ./web
COPY --from=build /out/csp-script-hashes ./csp-script-hashes
USER node
EXPOSE 4000 4100
CMD ["node", "main.mjs"]
