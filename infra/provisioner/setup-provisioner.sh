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
install -d -m 700 "$CONF_DIR" /etc/letsencrypt-tenants /etc/letsencrypt-tenants/credentials
install -d -m 755 /var/lib/hoandat-tenant-acme

source /root/.nvm/nvm.sh >/dev/null
if [ ! -f "$CONF_DIR/key.pem" ]; then
	node dist/tenant-provisioner.mjs keygen "$CONF_DIR/keys"
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
