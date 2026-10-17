#!/bin/bash
# Builds the nginx configuration of a self-hosted install (ADR 0007) from
# the apps' own tenant server blocks, so every route, limit and header is
# the one production uses. The apps share nginx's network namespace, so
# their loopback upstreams stay as they are; only what differs in the
# bundle changes: no IPv6 listeners, Localman's CSP gets the script hashes
# of this build, and chat's block serves the install's one tenant on any
# domain.
#   assemble.sh <auth-src> <localman-src> <chat-src> <localman-csp-file> <out-dir>
set -euo pipefail
AUTH="$1" LOCALMAN="$2" CHAT="$3" HASHES_FILE="$4" OUT="$5"

mkdir -p "$OUT/conf.d" "$OUT/localman"
cp "$AUTH/infra/nginx/tenants-http.conf" "$OUT/conf.d/00-tenants-http.conf"
cp "$AUTH/infra/nginx/tenants-acme.conf" "$OUT/conf.d/tenants-acme.conf"
cp "$AUTH/infra/nginx/tenant-auth.conf" "$OUT/conf.d/tenant-auth.conf"
cp "$LOCALMAN/infra/localman/nginx/localman-http.conf" "$OUT/conf.d/localman-http.conf"
cp "$LOCALMAN/infra/localman/nginx/localman-app.inc" "$OUT/localman/localman-app.inc"
hashes="$(cat "$HASHES_FILE")"
# Base64 hashes never contain '|' or '&'.
sed "s|__CSP_SCRIPT_HASHES__|$hashes|" "$LOCALMAN/infra/localman/nginx/localman-tenants.conf" >"$OUT/conf.d/localman-tenants.conf"
awk '
	/^    location \/internal\/ \{$/ && !done { print "    include /etc/nginx/localman/localman-internal.inc;"; skip = 1; next }
	skip && /^    \}$/ { skip = 0; done = 1; next }
	skip { next }
	{ print }
' "$OUT/conf.d/localman-tenants.conf" >"$OUT/conf.d/localman-tenants.conf.tmp"
mv "$OUT/conf.d/localman-tenants.conf.tmp" "$OUT/conf.d/localman-tenants.conf"
cp "$(dirname "$0")/localman-internal.inc" "$OUT/localman/localman-internal.inc"
cp "$LOCALMAN/infra/tunelo/nginx-tenants.conf" "$OUT/conf.d/tunelo-tenants.conf"
cp "$CHAT/infra/chat/nginx/chat-http.conf" "$OUT/conf.d/chat-http.conf"
# Chat's primary conf opens with http-level zones, maps and log formats its
# tenant block uses; on the shared host that file is always installed.
awk '/^server \{/ { exit } { print }' "$CHAT/infra/chat/nginx/chat.hoandat.com.conf" >"$OUT/conf.d/01-chat-zones.conf"

# Chat renders its tenant block from its primary conf and a tenants dir;
# its map sends a known chat.<domain> to that tenant's port. An install has
# one tenant on 4600, whatever its domain: the map's default becomes 4600.
tenants="$(mktemp -d)"
printf 'TENANT_DOMAIN=selfhosted.invalid\nCHAT_LISTEN_ADDR=127.0.0.1:4600\n' >"$tenants/primary.env"
bash "$CHAT/infra/chat/render-tenants-nginx.sh" "$CHAT/infra/chat/nginx" "$tenants" |
	sed -e 's/^\tdefault "";$/\tdefault 4600;/' -e '/^\tchat\.selfhosted\.invalid 4600;$/d' >"$OUT/conf.d/chat-tenants.conf"
rm -rf "$tenants"
if ! grep -q '^	default 4600;$' "$OUT/conf.d/chat-tenants.conf" || grep -q 'selfhosted.invalid' "$OUT/conf.d/chat-tenants.conf"; then
	echo "assemble: chat's port map did not take the default" >&2
	exit 1
fi

for file in "$OUT"/conf.d/*.conf "$OUT"/localman/*.inc; do
	sed -e '/listen \[::\]:/d' "$file" >"$file.tmp"
	mv "$file.tmp" "$file"
done

if ! grep -q 'include /etc/nginx/localman/localman-internal.inc;' "$OUT/conf.d/localman-tenants.conf"; then
	echo "assemble: Localman's /internal/ block was not found" >&2
	exit 1
fi
if grep -rn '__CSP_SCRIPT_HASHES__' "$OUT"; then
	echo "assemble: Localman's CSP placeholder is still there" >&2
	exit 1
fi
