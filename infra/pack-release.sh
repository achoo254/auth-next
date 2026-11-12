#!/bin/bash
# Copies what an auth-next release needs from a built checkout (`pnpm build`) into <out-dir>: the bundles, the static
# files and brand icons the server serves, infra/ (pm2 ecosystem, activation) and the manifests the server installs
# production dependencies from. Used by .github/workflows/deploy.yml and by infra/deploy.sh.
#   bash infra/pack-release.sh <out-dir>
set -euo pipefail
out="${1:?usage: infra/pack-release.sh <out-dir>}"
cd "$(dirname "$0")/.."
[ -f dist/server.mjs ] || { echo "no dist/server.mjs: run pnpm build first" >&2; exit 1; }
mkdir -p "$out"
COPYFILE_DISABLE=1 tar -cf - --exclude '._*' --exclude .DS_Store \
	dist static brand infra package.json pnpm-lock.yaml pnpm-workspace.yaml |
	tar -xf - -C "$out"
