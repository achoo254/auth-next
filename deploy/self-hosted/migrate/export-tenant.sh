#!/bin/bash
# Exports a tenant that moves from hoandat to its own install (ADR 0007
# §7), on the shared server, as root, after its owner started the move at
# /claim (the tenant is `migrating`) and sent the install's
# data/secrets/migration-key.pub.json:
#   bash export-tenant.sh <domain> <migration-key.pub.json> <out-dir>
# Stops the tenant's chat process (writes after the export would not move;
# `pm2 start chat-api-<id>` undoes it), then writes to out-dir (new, 700):
#   idp-secrets.jwe   signing keys, OAuth apps, bot, Chat's session key,
#                     sealed to the install's migration key
#   idp/              the tenant's IdP documents (mongodump)
#   localman/         its Localman documents, secret values sealed again
#   tunelo/           its Tunelo API keys and usage (mongodump)
#   chat.sql          its chat rows (psql script), when it has a chat here
# Back up the three databases first. Send out-dir to the install over SSH
# only (it holds people's data) and delete it once imported. Prints
# names and counts, never a secret.
set -euo pipefail

DOMAIN="${1:?usage: export-tenant.sh <domain> <migration-key.pub.json> <out-dir>}"
PUBLIC_KEY="$(realpath "${2:?usage: export-tenant.sh <domain> <migration-key.pub.json> <out-dir>}")"
OUT="${3:?usage: export-tenant.sh <domain> <migration-key.pub.json> <out-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"
IDP=/var/www/hoandat-auth
LOCALMAN=/opt/localman
TUNELO=/var/www/tunelo
CHAT_TENANTS=/opt/chat/tenants
# Every collection with tenantId of the IdP (TENANT_COLLECTIONS; a test keeps
# this list equal to it).
IDP_COLLECTIONS="accounts one_time_tokens audit_outbox session_meta grant_meta
	oidc_accesstoken oidc_authorizationcode oidc_backchannelauthenticationrequest
	oidc_client oidc_clientcredentials oidc_devicecode oidc_grant
	oidc_initialaccesstoken oidc_interaction oidc_preauthorizedcode
	oidc_pushedauthorizationrequest oidc_refreshtoken
	oidc_registrationaccesstoken oidc_replaydetection oidc_session"
TUNELO_COLLECTIONS="apikeys usagelogs"

die() { echo "export-tenant: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root"
[[ "$DOMAIN" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "domain: a plain lowercase hostname"
[ ! -e "$OUT" ] || die "$OUT already exists"
umask 077
mkdir "$OUT"
OUT="$(realpath "$OUT")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The tenant's chat process, by its domain.
# A tenant's chat runs here only once set up for it (setup-tenant.sh of
# chat-next); without one there is no chat to move.
CHAT_ENV="$(grep -lxF "TENANT_DOMAIN=$DOMAIN" "$CHAT_TENANTS"/*.env 2>/dev/null | head -n 1 || true)"
CHAT_ID=""
: >"$WORK/app-settings"
if [ -n "$CHAT_ENV" ]; then
	CHAT_ID="$(basename "$CHAT_ENV" .env)"
	printf 'CHAT_SESSION_KEY_PREVIOUS=%s\n' "$(sed -n 's/^SESSION_KEY=//p' "$CHAT_ENV" | tail -n 1)" >"$WORK/app-settings"
fi

echo "== IdP secrets"
sealed="$(cd "$IDP" && node --env-file=.env dist/export-tenant-secrets.mjs \
	"$DOMAIN" "$PUBLIC_KEY" "$OUT/idp-secrets.jwe" "$WORK/app-settings")"
echo "$sealed"
TENANT_ID="$(sed -n 's/.*(\(ten_[A-Za-z0-9_-]*\)).*/\1/p' <<<"$sealed")"
[ -n "$TENANT_ID" ] || die "the IdP did not name the tenant"

if [ -n "$CHAT_ID" ]; then
	echo "== chat: stopping chat-api-$CHAT_ID"
	pm2 stop "chat-api-$CHAT_ID" >/dev/null
fi

# mongodump of the tenant's documents of each collection; the URI only in a
# file of mode 600.
dump() {
	local env_file="$1" name="$2" out="$3" collections="$4"
	printf 'uri: "%s"\n' "$(sed -n "s/^$name=//p" "$env_file" | tail -n 1)" >"$WORK/mongo.yaml"
	for collection in $collections; do
		mongodump --quiet --config="$WORK/mongo.yaml" --collection="$collection" \
			--query="{\"tenantId\":\"$TENANT_ID\"}" --out="$out"
	done
	find "$out" -name '*.bson' -printf '%f %s bytes\n' | sort
}
echo "== IdP documents"
dump "$IDP/.env" MONGO_URL "$OUT/idp" "$IDP_COLLECTIONS"
echo "== Localman documents"
(cd "$LOCALMAN/current/api" && "$LOCALMAN/runtime/node" --env-file="$LOCALMAN/.env" \
	export-tenant.mjs "$TENANT_ID" "$PUBLIC_KEY" "$OUT/localman")
echo "== Tunelo documents"
dump "$TUNELO/.env" MONGO_URI "$OUT/tunelo" "$TUNELO_COLLECTIONS"
if [ -n "$CHAT_ID" ]; then
	echo "== chat rows of $CHAT_ID"
	bash "$HERE/export-chat.sh" "$CHAT_ENV" "$OUT/chat.sql"
else
	echo "== chat: $DOMAIN has no chat here, nothing to move"
fi

printf 'domain=%s\ntenant=%s\nchat=%s\n' "$DOMAIN" "$TENANT_ID" "$CHAT_ID" >"$OUT/move.env"
echo "export-tenant: wrote $OUT ($(du -sh "$OUT" | cut -f1)); send it to the install, then run migrate/import-tenant.sh there"
