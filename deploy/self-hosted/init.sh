#!/bin/bash
# Prepares a self-hosted install (ADR 0007) from .env: generates its
# secrets once (kept in data/secrets/generated.env, mode 600, reused on
# every later run), writes each app's env file under data/env, copies the
# enrollment bundle, builds the images, and creates the IdP's signing,
# enrollment and migration keys with the IdP's own image. Prints no
# secret. Re-run it after changing .env; generated secrets never change.
#   ./init.sh                      builds the images from LOCALMAN_SRC, CHAT_SRC (about 4 GB RAM)
#   ./init.sh --release [x.y.z]    pulls the signed release images instead (no build, no sources)
set -euo pipefail
cd "$(dirname "$0")"
umask 077
RELEASE=""
if [ "${1:-}" = --release ]; then RELEASE="${2:-latest}"; fi

[ -f .env ] || { echo "init: copy .env.example to .env and fill it in" >&2; exit 1; }

# KEY=VALUE lines of .env, read verbatim (values may contain spaces).
setting() {
	sed -n "s/^$1=//p" .env | tail -n 1
}
require() {
	local value
	value="$(setting "$1")"
	[ -n "$value" ] || { echo "init: $1 is missing in .env" >&2; exit 1; }
	printf '%s' "$value"
}

DOMAIN="$(require DOMAIN)"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || { echo "init: DOMAIN must be a lowercase domain" >&2; exit 1; }
DISPLAY_NAME="$(setting DISPLAY_NAME)"
DISPLAY_NAME="${DISPLAY_NAME:-$DOMAIN}"
GATEWAY="$(require GATEWAY)"
BUNDLE="$(require ENROLLMENT_BUNDLE)"
if [ -z "$RELEASE" ]; then
	require LOCALMAN_SRC >/dev/null
	require CHAT_SRC >/dev/null
fi
require ACME_EMAIL >/dev/null
CLOUDFLARE_DNS_TOKEN="$(require CLOUDFLARE_DNS_TOKEN)"
GOOGLE_CLIENT_ID="$(setting GOOGLE_CLIENT_ID)"
GOOGLE_CLIENT_SECRET="$(setting GOOGLE_CLIENT_SECRET)"
GITHUB_CLIENT_ID="$(setting GITHUB_CLIENT_ID)"
GITHUB_CLIENT_SECRET="$(setting GITHUB_CLIENT_SECRET)"
if [ -z "$GOOGLE_CLIENT_SECRET$GITHUB_CLIENT_SECRET" ]; then
	echo "init: set the OAuth app of Google or GitHub in .env" >&2
	exit 1
fi
TURNSTILE_SITE_KEY="$(require TURNSTILE_SITE_KEY)"
TURNSTILE_SECRET_KEY="$(require TURNSTILE_SECRET_KEY)"
PUBLIC_IPV4="$(setting PUBLIC_IPV4)"
TCP_PORT_RANGE="$(setting TCP_PORT_RANGE)"
TCP_PORT_RANGE="${TCP_PORT_RANGE:-10000-10099}"

# Values compose needs from this run, kept in .env itself (not secret).
set_setting() {
	if grep -q "^$1=" .env; then
		sed "s|^$1=.*|$1=$2|" .env >.env.tmp && mv .env.tmp .env
	else
		printf '%s=%s\n' "$1" "$2" >>.env
	fi
}
set_setting PUID "$(id -u)"
set_setting PGID "$(id -g)"
set_setting SELFHOSTED_DIR "$(pwd)"
chmod 600 .env

mkdir -p data/env data/secrets/auth
chmod 700 data data/env data/secrets data/secrets/auth

# Random secrets: base64url without padding, and keyrings of 32-byte keys.
random_url() { openssl rand -base64 "$1" | tr '+/' '-_' | tr -d '=\n'; }
random_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
GENERATED=data/secrets/generated.env
if [ ! -f "$GENERATED" ]; then
	{
		echo "COOKIE_KEY=$(random_url 48)"
		echo "LOCALMAN_WEB_CLIENT_SECRET=$(random_url 48)"
		echo "TUNELO_WEB_CLIENT_SECRET=$(random_url 48)"
		echo "CHAT_WEB_CLIENT_SECRET=$(random_url 48)"
		echo "AUDIT_CLIENT_SECRET=$(random_url 48)"
		echo "LOCALMAN_SESSION_KEYRING=k1:$(random_b64 32)"
		echo "LOCALMAN_VARIABLE_KEYRING=k1:$(random_b64 32)"
		echo "TUNELO_WEB_SESSION_KEY=$(random_url 32)"
		echo "CHAT_SESSION_KEY=$(random_b64 32)"
		echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
	} >"$GENERATED"
	echo "init: generated the install's secrets in $GENERATED"
fi
generated() {
	sed -n "s/^$1=//p" "$GENERATED"
}

printf '%s' "$(generated POSTGRES_PASSWORD)" >data/secrets/postgres-password
printf 'dns_cloudflare_api_token = %s\n' "$CLOUDFLARE_DNS_TOKEN" >data/secrets/cloudflare.ini
cp "$BUNDLE" data/secrets/auth/enrollment.jwt

AUTH="https://auth.$DOMAIN"
cat >data/env/auth.env <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=4500
ISSUER=$AUTH
TENANT_DOMAIN=$DOMAIN
TENANT_DISPLAY_NAME=$DISPLAY_NAME
TRUST_PROXY=127.0.0.1
MONGO_URL=mongodb://mongo:27017/auth?replicaSet=rs0
SIGNING_KEYS_PATH=/run/secrets/hoandat-auth/signing-keys.json
COOKIE_KEYS=$(generated COOKIE_KEY)
LOCALMAN_WEB_URL=https://localman.$DOMAIN
LOCALMAN_WEB_CLIENT_SECRET=$(generated LOCALMAN_WEB_CLIENT_SECRET)
TUNELO_WEB_URL=https://tunnel.$DOMAIN
TUNELO_WEB_CLIENT_SECRET=$(generated TUNELO_WEB_CLIENT_SECRET)
CHAT_WEB_URL=https://chat.$DOMAIN
CHAT_WEB_CLIENT_SECRET=$(generated CHAT_WEB_CLIENT_SECRET)
GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
AUDIT_EVENTS_URL=https://localman.$DOMAIN/internal/audit-events
AUDIT_CLIENT_ID=hoandat-auth
AUDIT_CLIENT_SECRET=$(generated AUDIT_CLIENT_SECRET)
ENROLLMENT_GATEWAY=$GATEWAY
ENROLLMENT_BUNDLE_PATH=/run/secrets/hoandat-auth/enrollment.jwt
ENROLLMENT_KEY_PATH=/run/secrets/hoandat-auth/enrollment-key.json
EOF
# The bot of a tenant moved from hoandat (migrate/import-tenant.sh).
for name in TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME TELEGRAM_WEBHOOK_SECRET; do
	value="$(setting "$name")"
	if [ -n "$value" ]; then printf '%s=%s\n' "$name" "$value" >>data/env/auth.env; fi
done

cat >data/env/localman.env <<EOF
NODE_ENV=production
TRUST_PROXY=loopback
MONGO_URI=mongodb://mongo:27017/localman?replicaSet=rs0
PUBLIC_URL=https://localman.$DOMAIN
WEB_ORIGIN=https://localman.$DOMAIN
MOCK_BASE_DOMAIN=localman.$DOMAIN
TUNNEL_DOMAINS=tunnel.$DOMAIN
OIDC_ISSUER=$AUTH
OIDC_CLIENT_ID=localman-web
OIDC_CLIENT_SECRET=$(generated LOCALMAN_WEB_CLIENT_SECRET)
SESSION_ENCRYPTION_KEY=$(generated LOCALMAN_SESSION_KEYRING)
VARIABLE_ENCRYPTION_KEY=$(generated LOCALMAN_VARIABLE_KEYRING)
AUDIT_CLIENT_ID=hoandat-auth
AUDIT_CLIENT_SECRET=$(generated AUDIT_CLIENT_SECRET)
TURNSTILE_SITE_KEY=$TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY=$TURNSTILE_SECRET_KEY
EOF

cat >data/env/tunelo.env <<EOF
NODE_ENV=production
MONGO_URI=mongodb://mongo:27017/tunelo?replicaSet=rs0
TUNNEL_DOMAINS=tunnel.$DOMAIN
TCP_PORT_RANGE=$TCP_PORT_RANGE
AUTH_ISSUER=$AUTH
AUTH_AUDIENCE=https://tunnel.$DOMAIN
TUNELO_WEB_CLIENT_ID=tunelo-web
TUNELO_WEB_CLIENT_SECRET=$(generated TUNELO_WEB_CLIENT_SECRET)
TUNELO_WEB_PUBLIC_URL=https://tunnel.$DOMAIN
WEB_SESSION_KEY=$(generated TUNELO_WEB_SESSION_KEY)
EOF

cat >data/env/chat.env <<EOF
CHAT_ENV=production
DATABASE_URL=postgres://chat:$(generated POSTGRES_PASSWORD)@postgres:5432/chat?sslmode=disable
CHAT_PUBLIC_URL=https://chat.$DOMAIN
TENANT_DOMAIN=$DOMAIN
OIDC_ISSUER=$AUTH
OIDC_CLIENT_ID=chat-web
OIDC_CLIENT_SECRET=$(generated CHAT_WEB_CLIENT_SECRET)
SESSION_KEY=$(generated CHAT_SESSION_KEY)
EOF
if [ -n "$PUBLIC_IPV4" ]; then
	echo "OUTBOUND_DENY_CIDRS=$PUBLIC_IPV4/32" >>data/env/chat.env
fi
echo "init: wrote data/env/{auth,localman,tunelo,chat}.env"

# Images, then the IdP's keys made by the IdP's own image as this user.
AUTH_IMAGE=selfhosted-auth
if [ -n "$RELEASE" ]; then
	if [ "$RELEASE" = latest ]; then bash update.sh --fetch; else bash update.sh --fetch "$RELEASE"; fi
	AUTH_IMAGE="$(sed -n 's/^RELEASE_REGISTRY=//p' release.env)/selfhosted-auth@$(sed -n 's/^AUTH_DIGEST=//p' release.env)"
else
	docker compose build
fi
run_auth() {
	docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
		-v "$(pwd)/data/secrets/auth:/out" "$AUTH_IMAGE" "$@"
}
if [ ! -f data/secrets/auth/signing-keys.json ]; then
	run_auth dist/generate-signing-key.mjs /out/signing-keys.json
fi
if [ ! -f data/secrets/auth/enrollment-key.json ]; then
	run_auth --input-type=module -e '
		import { writeFileSync } from "node:fs";
		import { exportJWK, generateKeyPair } from "jose";
		const { privateKey } = await generateKeyPair("ES256", { extractable: true });
		writeFileSync("/out/enrollment-key.json", JSON.stringify(await exportJWK(privateKey)), { mode: 0o600, flag: "wx" });'
	echo "init: created the install's enrollment key"
fi
# Moving a tenant that runs on hoandat here (ADR 0007 §7): its secrets
# are sealed to the public half, which goes to hoandat's operators.
if [ ! -f data/secrets/migration-key.json ]; then
	docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
		-v "$(pwd)/data/secrets:/out" "$AUTH_IMAGE" --input-type=module -e '
		import { writeFileSync } from "node:fs";
		import { exportJWK, generateKeyPair } from "jose";
		const { publicKey, privateKey } = await generateKeyPair("ECDH-ES+A256KW", { crv: "P-256", extractable: true });
		writeFileSync("/out/migration-key.json", JSON.stringify(await exportJWK(privateKey)), { mode: 0o600, flag: "wx" });
		writeFileSync("/out/migration-key.pub.json", JSON.stringify(await exportJWK(publicKey)), { mode: 0o644, flag: "wx" });'
	echo "init: created the install's migration key (data/secrets/migration-key.pub.json)"
fi
if [ -n "$RELEASE" ]; then
	echo "init: done; start with: ./update.sh $(sed -n 's/^RELEASE_VERSION=//p' release.env)"
else
	echo "init: done; start with: docker compose up -d"
fi
