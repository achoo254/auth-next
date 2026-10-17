#!/bin/bash
# Prepares a self-hosted install (ADR 0007) from .env: generates its
# secrets once (kept in data/secrets/generated.env, mode 600, reused on
# every later run), writes each app's env file under data/env, copies the
# enrollment bundle, builds the images, and creates the IdP's signing and
# enrollment keys with the IdP's own image. Prints no secret. Re-run it
# after changing .env; generated secrets never change.
#   ./init.sh
set -euo pipefail
cd "$(dirname "$0")"
umask 077

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
require LOCALMAN_SRC >/dev/null
require CHAT_SRC >/dev/null
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
TRUST_PROXY=loopback
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
docker compose build
run_auth() {
	docker run --rm --user "$(id -u):$(id -g)" --entrypoint node \
		-v "$(pwd)/data/secrets/auth:/out" selfhosted-auth "$@"
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
echo "init: done; start with: docker compose up -d"
