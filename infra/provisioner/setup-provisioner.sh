#!/bin/bash
# One-time setup of the tenant certificate provisioner on the shared host
# (ADR 0006, docs/deployment-guide.md "Provisioner"). Run as root from
# /var/www/hoandat-auth after a deploy that ships dist/tenant-provisioner.mjs.
# Idempotent: existing keys, env and directories are kept. It installs and
# enables the timers but never touches nginx: copying the tenant server
# blocks is a separate, announced step (nginx -t before reload).
set -euo pipefail
cd "$(dirname "$0")/../.."

CONF_DIR=/etc/hoandat-tenant-provisioner
LIB_DIR=/usr/local/lib/hoandat-tenant-provisioner
NGINX_GROUP="$(awk '/^user /{gsub(/;/,"",$2); print $2}' /etc/nginx/nginx.conf)"
NGINX_GROUP="${NGINX_GROUP:-nginx}"

# Root-owned copy: the IdP (which may run as root today) must not be able
# to swap the code that holds the provisioner's private key.
install -d -m 755 -o root -g root "$LIB_DIR"
install -m 644 -o root -g root dist/tenant-provisioner.mjs "$LIB_DIR/tenant-provisioner.mjs"

install -d -m 700 "$CONF_DIR" "$CONF_DIR/credentials"
# Certificates: nginx workers read them at handshake, through their group;
# the ACME account stays root-only.
install -d -m 750 -g "$NGINX_GROUP" /etc/letsencrypt-tenants /etc/letsencrypt-tenants/live /etc/letsencrypt-tenants/archive
install -d -m 700 /etc/letsencrypt-tenants/accounts
install -d -m 755 /var/lib/hoandat-tenant-acme

source /root/.nvm/nvm.sh >/dev/null
if [ ! -f "$CONF_DIR/key.pem" ]; then
	node "$LIB_DIR/tenant-provisioner.mjs" keygen "$CONF_DIR/keys"
	mv "$CONF_DIR/keys/key.pem" "$CONF_DIR/key.pem"
	mv "$CONF_DIR/keys/key.pub.pem" "$CONF_DIR/key.pub.pem"
	rmdir "$CONF_DIR/keys"
fi
# The IdP reads only the public key.
install -m 644 "$CONF_DIR/key.pub.pem" /var/www/hoandat-auth/secrets/provisioner.pub.pem

if [ ! -f "$CONF_DIR/env" ]; then
	umask 077
	cat > "$CONF_DIR/env" <<ENV
PROVISIONER_INTERNAL_URL=http://127.0.0.1:4501
# Same value as the provisioner entry of INTERNAL_API_CREDENTIALS in the IdP .env.
PROVISIONER_INTERNAL_SECRET=
PROVISIONER_PRIVATE_KEY_PATH=$CONF_DIR/key.pem
PROVISIONER_NGINX_GROUP=$NGINX_GROUP
# staging until a test domain worked end to end, then production.
PROVISIONER_ACME=staging
PROVISIONER_BLOCKED_DOMAINS=hoandat.com,inetdev.io.vn
ENV
	echo "Fill PROVISIONER_INTERNAL_SECRET in $CONF_DIR/env, then rerun."
	exit 0
fi

install -m 644 infra/provisioner/hoandat-tenant-*.service infra/provisioner/hoandat-tenant-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hoandat-tenant-provisioner.timer hoandat-tenant-certbot-renew.timer
systemctl list-timers --all | grep hoandat-tenant
