#!/bin/bash
# Break-glass deploy of hoandat-auth; a push to main deploys through .github/workflows/deploy.yml.
#   SSH_TARGET=<ssh host alias or root@host> [SSH_OPTS="-F ssh_config"] bash infra/deploy.sh
# Refuses a dirty tree, a commit not on origin/main or a commit whose ci run is not green, runs lint, typecheck and
# the build here, packs (infra/pack-release.sh), uploads to /var/www/hoandat-auth/ci-incoming/<id> and runs the same
# activation as CI (infra/activate-incoming.sh: flock, install, indexes, switch, /healthz, rollback). The server keeps
# .env and secrets/ in /var/www/hoandat-auth; they are never synced from here. First-time setup:
# infra/setup-server.sh (see docs/deployment-guide.md).
set -euo pipefail
cd "$(dirname "$0")/.."

SSH_TARGET="${SSH_TARGET:?set SSH_TARGET to the server ssh alias}"
REMOTE_DIR=/var/www/hoandat-auth
# Extra ssh options, e.g. SSH_OPTS="-F /path/to/ssh_config" for a key kept outside ~/.ssh.
SSH="ssh ${SSH_OPTS:-}"

echo "== guards"
# The release must be exactly a commit that is already on origin/main.
if [ -n "$(git status --porcelain)" ]; then
	echo "working tree is not clean: commit or stash first (git status)" >&2
	exit 1
fi
git fetch --quiet origin main
if ! git merge-base --is-ancestor HEAD origin/main; then
	echo "HEAD $(git rev-parse --short HEAD) is not on origin/main: push it first" >&2
	exit 1
fi
# The full test suite runs only in CI (CLAUDE.md): this commit's ci run must be green.
sha="$(git rev-parse HEAD)"
ci="$(gh run list --workflow ci.yml --commit "$sha" --json status,conclusion --jq '.[0] | "\(.status) \(.conclusion)"')"
if [ "$ci" != "completed success" ]; then
	echo "ci for $sha is '${ci:-missing}', not green: gh run watch, then deploy" >&2
	exit 1
fi

echo "== gates and build"
pnpm lint
pnpm typecheck
pnpm build

release="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 HEAD)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
bash infra/pack-release.sh "$stage/release"

echo "== upload $release"
$SSH "$SSH_TARGET" "mkdir -p $REMOTE_DIR/ci-incoming/$release" </dev/null
rsync -rlptz -e "$SSH" "$stage/release/" "$SSH_TARGET:$REMOTE_DIR/ci-incoming/$release/"

echo "== activate (the same step CI runs; it waits for any other activation)"
$SSH "$SSH_TARGET" "install -m 755 -o root -g root $REMOTE_DIR/ci-incoming/$release/infra/activate-incoming.sh /usr/local/sbin/hoandat-auth-activate-incoming && /usr/local/sbin/hoandat-auth-activate-incoming $release" </dev/null
