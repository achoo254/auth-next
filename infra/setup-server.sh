#!/bin/bash
# One-time preparation on the server, run as root from /var/www/hoandat-auth
# after the first `infra/deploy.sh` sync (the deploy's restart step fails until
# this has run). Idempotent: existing secrets and keys are kept.
#   bash infra/setup-server.sh
set -euo pipefail
cd /var/www/hoandat-auth
umask 077
source /root/.nvm/nvm.sh >/dev/null

secret() { openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-48; }

mkdir -p secrets backups
if [ ! -s secrets/signing-keys.json ]; then
	# ES256 signs everything by default; the RSA key is for RS256 ID tokens,
	# which OpenID Connect Discovery requires an OP to offer (ADR 0005).
	node dist/generate-signing-key.mjs secrets/signing-keys.json
	node dist/generate-signing-key.mjs secrets/signing-keys.json --alg RS256
fi

if [ ! -f .env ]; then
	cat > .env <<ENV
NODE_ENV=production
HOST=127.0.0.1
PORT=4500
ISSUER=https://auth.hoandat.com
LOG_LEVEL=info
MONGO_URL=mongodb://auth:$(secret)@127.0.0.1:27017/auth?authSource=auth
SIGNING_KEYS_PATH=/var/www/hoandat-auth/secrets/signing-keys.json
COOKIE_KEYS=$(secret)
LOCALMAN_WEB_CLIENT_SECRET=$(secret)
TUNELO_WEB_CLIENT_SECRET=$(secret)
LOCALMAN_WEB_URL=https://localman.hoandat.com
TUNELO_WEB_URL=https://tunnel.hoandat.com
TRUST_PROXY=127.0.0.1
ALLOWED_HOSTS=
ENV
	echo "wrote .env with fresh secrets"
fi
chmod 600 .env secrets/signing-keys.json
echo "setup done"
