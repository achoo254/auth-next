#!/bin/bash
# Deletes what the shared server still keeps of a tenant that moved to its
# own install (ADR 0007 §7), once the IdP has had it self_hosted for 14
# days (the backups' window, the way back). On the shared server, as root:
#   bash purge-tenant.sh <domain>            counts only
#   bash purge-tenant.sh <domain> --confirm  deletes
# The IdP's documents and sealed secrets (signing keys last), Localman's
# and Tunelo's documents, the chat rows. Back up the three databases
# first. Afterwards remove the tenant's chat process and env file
# (`pm2 delete chat-api-<id>`, /opt/chat/tenants/<id>.env). Prints names
# and counts, never a secret.
set -euo pipefail

DOMAIN="${1:?usage: purge-tenant.sh <domain> [--confirm]}"
CONFIRM=""
if [ "${2:-}" = --confirm ]; then CONFIRM=1; fi
HERE="$(cd "$(dirname "$0")" && pwd)"
IDP=/var/www/hoandat-auth
die() { echo "purge-tenant: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "domain: a plain lowercase hostname"

# The IdP refuses a tenant that is not self_hosted for 14 days, and names it.
counts="$(cd "$IDP" && node --env-file=.env dist/purge-tenant.mjs "$DOMAIN")"
TENANT_ID="$(sed -n 's/^tenant: \(ten_[A-Za-z0-9_-]*\)$/\1/p' <<<"$counts")"
[ -n "$TENANT_ID" ] || die "the IdP did not name the tenant"
echo "== IdP ($TENANT_ID)"
echo "$counts"

mongo_purge() {
	local env_file="$1" name="$2"
	(cd "$IDP" && MONGO_URI="$(sed -n "s/^$name=//p" "$env_file" | tail -n 1)" \
		TENANT_ID="$TENANT_ID" CONFIRM="$CONFIRM" \
		node --input-type=module -e "$(cat "$HERE/purge-mongo-tenant.mjs")")
}
echo "== Localman"
mongo_purge /opt/localman/.env MONGO_URI
echo "== Tunelo"
mongo_purge /var/www/tunelo/.env MONGO_URI

ENV_FILE="$(grep -lxF "TENANT_DOMAIN=$DOMAIN" /opt/chat/tenants/*.env 2>/dev/null | head -n 1 || true)"
if [ -n "$ENV_FILE" ]; then
	echo "== chat ($(basename "$ENV_FILE" .env))"
	# shellcheck source-path=SCRIPTDIR source=chat-tables.sh
	source "$HERE/chat-tables.sh"
	purge_chat_rows "$CONFIRM"
else
	echo "== chat: no tenant env file for $DOMAIN (already removed)"
fi

if [ -n "$CONFIRM" ]; then
	echo "== IdP"
	(cd "$IDP" && node --env-file=.env dist/purge-tenant.mjs "$DOMAIN" --confirm)
else
	echo "Counts only: run again with --confirm to delete"
fi
