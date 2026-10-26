#!/bin/bash
# Build locally and deploy hoandat-auth to the shared server under pm2.
#   SSH_TARGET=<ssh host alias or user@host> [SSH_OPTS="-F ssh_config"] bash infra/deploy.sh
# The server keeps .env and secrets/ in /var/www/hoandat-auth; they are never
# synced from here. First-time setup: infra/setup-server.sh (see
# docs/deployment-guide.md).
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_TARGET="${SSH_TARGET:?set SSH_TARGET to the server ssh alias}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/hoandat-auth}"
PNPM="npx --yes pnpm@11.9.0"
# Extra ssh options, e.g. SSH_OPTS="-F /path/to/ssh_config" for a key kept outside ~/.ssh.
SSH="ssh ${SSH_OPTS:-}"

echo "== build"
pnpm build

echo "== back up the running release (rollback: docs/deployment-guide.md), keep the 3 newest"
$SSH "$SSH_TARGET" "set -euo pipefail
	cd $REMOTE_DIR
	if [ ! -d dist ]; then echo 'no release yet, nothing to back up'; exit 0; fi
	backup=/root/hoandat-auth-backup-\$(date +%Y%m%d-%H%M%S)
	mkdir -p \"\$backup\"
	cp -a dist static infra package.json pnpm-lock.yaml pnpm-workspace.yaml \"\$backup\"/
	# brand/ (icons, web manifest) is absent in releases made before it shipped.
	if [ -d brand ]; then cp -a brand \"\$backup\"/; fi
	echo \"backup: \$backup\"
	ls -1d /root/hoandat-auth-backup-[0-9]*-[0-9]* | sort | head -n -3 | while read -r old; do
		echo \"remove old backup: \$old\"; rm -rf -- \"\$old\"
	done"

echo "== sync release files (no owner/group: files land owned by the remote root)"
rsync -rlptz --delete -e "$SSH" \
	--exclude .env --exclude secrets/ --exclude node_modules/ --exclude backups/ \
	dist static brand infra package.json pnpm-lock.yaml pnpm-workspace.yaml \
	"$SSH_TARGET:$REMOTE_DIR/"

echo "== install runtime dependencies, create indexes, restart"
$SSH "$SSH_TARGET" "set -euo pipefail
	source /root/.nvm/nvm.sh >/dev/null
	cd $REMOTE_DIR
	MONGOMS_DISABLE_POSTINSTALL=1 $PNPM install --prod --frozen-lockfile --reporter=silent
	# Indexes first (idempotent), so the new release starts without building them.
	node --env-file=.env dist/create-indexes.mjs
	pm2 startOrReload infra/ecosystem.config.cjs --update-env
	pm2 save >/dev/null
	for i in \$(seq 1 20); do
		if curl -fsS http://127.0.0.1:4500/healthz >/dev/null; then echo healthz ok; exit 0; fi
		sleep 1
	done
	echo 'healthz failed; recent log:'; pm2 logs hoandat-auth --lines 40 --nostream; exit 1"
