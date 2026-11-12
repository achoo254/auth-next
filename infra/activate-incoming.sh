#!/bin/bash
# Activates an auth-next release uploaded to /var/www/hoandat-auth/ci-incoming/<release-id> (by CI as
# `hoandat-auth-deploy`, or by infra/deploy.sh). Installed as root at /usr/local/sbin/hoandat-auth-activate-incoming;
# `hoandat-auth-deploy` may run only this command through sudo (infra/setup-deploy-user.sh).
#   hoandat-auth-activate-incoming <release-id>
# One activation at a time (flock). The upload becomes a root-owned releases/<id> (rejected if it holds links or
# special files or misses a part), gets production dependencies and builds its indexes while the running release
# still serves (a failure there leaves everything as it was). Then `current` points to it, pm2 runs
# current/infra/ecosystem.config.cjs and /healthz must answer within 20 s; otherwise the previous release (or, before
# the first release, the in-place files of /var/www/hoandat-auth) comes back and the script exits 1. .env, secrets/
# and backups/ stay in /var/www/hoandat-auth, outside the releases. Keeps the 5 newest releases.
set -euo pipefail
ROOT=/var/www/hoandat-auth
APP=hoandat-auth
PNPM="npx --yes pnpm@11.9.0"
ID="${1:?usage: hoandat-auth-activate-incoming <release-id>}"
[[ "$ID" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$ ]] || { echo "bad release id" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

# One activation at a time: a CI deploy and a manual release from a dev machine may meet.
exec 9>/run/hoandat-auth-activate.lock
flock -w 600 9 || { echo "another activation still holds /run/hoandat-auth-activate.lock" >&2; exit 1; }

# sudo keeps only the secure path; Node and pm2 live in root's nvm and /usr/local/bin.
export PATH="/usr/local/bin:$PATH"
# shellcheck disable=SC1091
source /root/.nvm/nvm.sh >/dev/null

SRC="$ROOT/ci-incoming/$ID"
DST="$ROOT/releases/$ID"
[ ! -e "$DST" ] || { echo "release $ID already exists" >&2; exit 2; }
[ -d "$SRC" ] && [ ! -L "$SRC" ] || { echo "incoming release $ID missing" >&2; exit 2; }
mkdir -p "$ROOT/releases"
mv "$SRC" "$DST"
chown -R root:root "$DST"
reject() {
	rm -rf "${DST:?}"
	echo "incoming release $ID $1" >&2
	exit 2
}
[ -z "$(find "$DST" ! -type f ! -type d -print -quit)" ] || reject "has links or special files"
for part in dist/server.mjs dist/create-indexes.mjs package.json pnpm-lock.yaml static brand infra/ecosystem.config.cjs; do
	[ -e "$DST/$part" ] || reject "has no $part"
done

echo "== production dependencies and indexes (the running release keeps serving)"
(cd "$DST" && MONGOMS_DISABLE_POSTINSTALL=1 $PNPM install --prod --frozen-lockfile --reporter=silent) ||
	reject "failed to install its production dependencies"
(cd "$DST" && node --env-file="$ROOT/.env" dist/create-indexes.mjs) || reject "failed to build its indexes"

healthy() {
	for _ in $(seq 1 20); do
		curl -fsS --max-time 3 http://127.0.0.1:4500/healthz >/dev/null && return 0
		sleep 1
	done
	return 1
}
# Recreated each time: a reload keeps the directory the process started in, which may be the previous release.
# In fork mode a reload restarts the process anyway. pm2 may start its daemon here; it must not inherit the lock
# (fd 9) or the lock would outlive this run.
run_from() {
	pm2 delete "$APP" >/dev/null 2>&1 9>&- || true
	pm2 start "$1" --update-env 9>&- && pm2 save 9>&- >/dev/null
}

prev="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
echo "== switch to $ID"
ln -sfn "$DST" "$ROOT/current.next"
mv -T "$ROOT/current.next" "$ROOT/current"
if run_from "$ROOT/current/infra/ecosystem.config.cjs" && healthy; then
	echo "healthz ok: auth.hoandat.com now runs $ID"
	ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
	exit 0
fi

pm2 logs "$APP" --lines 40 --nostream 9>&- || true
if [ -n "$prev" ] && [ -d "$prev" ]; then
	echo "release $ID failed: switching back to $(basename "$prev")" >&2
	ln -sfn "$prev" "$ROOT/current.next"
	mv -T "$ROOT/current.next" "$ROOT/current"
	run_from "$ROOT/current/infra/ecosystem.config.cjs" || true
elif [ -f "$ROOT/dist/server.mjs" ] && [ -f "$ROOT/infra/ecosystem.config.cjs" ]; then
	echo "release $ID failed: back to the in-place files of $ROOT" >&2
	rm -f "$ROOT/current"
	run_from "$ROOT/infra/ecosystem.config.cjs" || true
fi
if healthy; then echo "previous version is back and healthy" >&2; else echo "previous version is not healthy either" >&2; fi
exit 1
