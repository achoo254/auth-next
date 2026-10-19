#!/bin/bash
# Takes a tenant moved from hoandat into this install (ADR 0007 §7), where
# it becomes the primary tenant. Run in the install folder, on a fresh
# install (nobody signed in yet), with what export-tenant.sh wrote:
#   bash migrate/import-tenant.sh <dir>
# Backs up both databases, stops the apps, restores the IdP, Localman,
# Tunelo and chat data, puts the tenant's signing keys in place and its
# OAuth apps and bot in .env, seals the chat bots' webhook secrets again
# with this install's session key, and starts the apps. Prints names and
# counts, never a secret. Then point the DNS records at this server.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

DIR="$(realpath "${1:?usage: import-tenant.sh <dir>}")"
KEY=data/secrets/migration-key.json
die() { echo "import-tenant: $*" >&2; exit 1; }
moved() { sed -n "s/^$1=//p" "$DIR/move.env"; }
[ -f "$KEY" ] || die "no $KEY: run init.sh"
for file in move.env idp-secrets.jwe chat.sql; do [ -f "$DIR/$file" ] || die "no $DIR/$file"; done
DOMAIN="$(moved domain)"
TENANT_ID="$(moved tenant)"
[[ "$TENANT_ID" =~ ^ten_[A-Za-z0-9_-]+$ ]] || die "no tenant in $DIR/move.env"
[ "$DOMAIN" = "$(sed -n 's/^DOMAIN=//p' .env | tail -n 1)" ] || die "$DIR is for $DOMAIN, not this install's domain"

LOCAL=()
if [ -f compose.override.yaml ]; then LOCAL=(-f compose.override.yaml); fi
C=(docker compose -f compose.yaml "${LOCAL[@]}" --env-file .env)
if [ -f release.env ]; then
	C=(docker compose -f compose.yaml -f compose.release.yaml "${LOCAL[@]}" --env-file .env --env-file release.env)
fi
USER_FLAG=(--user "$(id -u):$(id -g)")

# KEY=VALUE in an env file, replaced or added.
set_line() {
	local file="$1" name="$2" value="$3"
	grep -v "^$name=" "$file" >"$file.tmp" || true
	printf '%s=%s\n' "$name" "$value" >>"$file.tmp"
	mv "$file.tmp" "$file"
}
# Restores a mongodump folder (one database inside) into database $2.
restore_mongo() {
	local from="$1" to="$2" source
	source="$(basename "$(find "$from" -mindepth 1 -maxdepth 1 -type d | head -n 1)")"
	tar -C "$from" -c . | "${C[@]}" exec -T mongo sh -c \
		'rm -rf /tmp/move && mkdir /tmp/move && tar -x -C /tmp/move &&
		mongorestore --quiet --noIndexRestore --nsFrom="$1.*" --nsTo="$2.*" /tmp/move; status=$?; rm -rf /tmp/move; exit $status' \
		sh "$source" "$to"
}

schema="$("${C[@]}" exec -T postgres psql -U chat -d chat -XAt -c "SELECT max(version_id) FROM goose_db_version")"
[ "$(head -n 1 "$DIR/chat.sql")" = "-- chat schema $schema" ] || die "chat.sql is of another chat version than this install ($schema)"
# Chat makes its own assistant bot at every start: a fresh install has that
# one user only. The moved tenant brings its own assistant, which replaces it.
OWN_ASSISTANT="SELECT user_id FROM bots WHERE is_system"
users="$("${C[@]}" exec -T postgres psql -U chat -d chat -XAt -c "SELECT count(*) FROM users WHERE id NOT IN ($OWN_ASSISTANT)")"
[ "$users" = 0 ] || die "this install's chat already has $users users; import into a fresh install"

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "data/backups/$stamp"
"${C[@]}" exec -T mongo mongodump --archive --gzip >"data/backups/$stamp/mongo.archive.gz"
"${C[@]}" exec -T postgres pg_dump -U chat -Fc chat >"data/backups/$stamp/chat.pgdump"
echo "import-tenant: backed up to data/backups/$stamp"
"${C[@]}" stop auth localman tunelo chat

echo "== IdP"
restore_mongo "$DIR/idp" auth
"${C[@]}" run --rm --no-deps -v "$DIR:/move" -v "$(pwd)/$KEY:/run/migration-key.json:ro" auth \
	node dist/import-tenant.mjs /move/idp-secrets.jwe /run/migration-key.json /move/signing-keys.json /move/settings.env
cp -p data/secrets/auth/signing-keys.json "data/backups/$stamp/signing-keys.json"
mv "$DIR/signing-keys.json" data/secrets/auth/signing-keys.json
SESSION_KEY_PREVIOUS=""
while IFS= read -r line; do
	name="${line%%=*}"
	[ -n "$line" ] && [ "$name" != "$line" ] || continue
	if [ "$name" = CHAT_SESSION_KEY_PREVIOUS ]; then
		SESSION_KEY_PREVIOUS="${line#*=}"
	else
		set_line .env "$name" "${line#*=}"
		set_line data/env/auth.env "$name" "${line#*=}"
	fi
done <"$DIR/settings.env"
rm -f "$DIR/settings.env"

echo "== Localman"
"${C[@]}" run --rm --no-deps "${USER_FLAG[@]}" -v "$DIR/localman:/move:ro" \
	-v "$(pwd)/$KEY:/run/migration-key.json:ro" localman node import-tenant.mjs /move /run/migration-key.json

echo "== Tunelo"
restore_mongo "$DIR/tunelo" tunelo
"${C[@]}" exec -T mongo mongosh --quiet tunelo --eval "
	for (const name of ['apikeys', 'usagelogs']) {
		const result = db.getCollection(name).updateMany({ tenantId: '$TENANT_ID' }, { \$set: { tenantId: 'primary' } });
		print(name + ': ' + result.modifiedCount);
	}"

echo "== chat"
"${C[@]}" exec -T postgres psql -U chat -d chat -X -q -v ON_ERROR_STOP=1 -c "DELETE FROM users WHERE id IN ($OWN_ASSISTANT)"
"${C[@]}" exec -T postgres psql -U chat -d chat -X -q <"$DIR/chat.sql"
"${C[@]}" exec -T postgres psql -U chat -d chat -XAt -c "SELECT 'users: ' || count(*) FROM users UNION ALL SELECT 'chats: ' || count(*) FROM chats"
if [ -n "$SESSION_KEY_PREVIOUS" ]; then
	set_line data/env/chat.env SESSION_KEY_PREVIOUS "$SESSION_KEY_PREVIOUS"
	"${C[@]}" run --rm --no-deps chat -role reseal
	grep -v '^SESSION_KEY_PREVIOUS=' data/env/chat.env >data/env/chat.env.tmp
	mv data/env/chat.env.tmp data/env/chat.env
fi

"${C[@]}" up -d nginx auth localman tunelo chat
echo "import-tenant: $DOMAIN is in; data backups in data/backups/$stamp."
echo "Point the A records of auth., localman., tunnel., chat. and *.localman., *.tunnel. of $DOMAIN at this server;"
echo "the install then completes its enrollment and hoandat stops serving the tenant. Delete $DIR."
