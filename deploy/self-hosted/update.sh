#!/bin/bash
# Moves a self-hosted install to a release (ADR 0007), when its operator
# runs it; nothing comes from the gateway unasked.
#   ./update.sh            the newest release
#   ./update.sh 1.2.0      that release
# Signs in to the gateway's release registry with the credentials the IdP
# kept when it enrolled, verifies every image's cosign signature (made by
# hoandat-auth's release workflow) on the exact digest it will run, takes
# the release's own bundle files, backs up MongoDB and Postgres, then
# switches; if the stack does not come up healthy it goes back to the
# previous release. Prints no secret.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# The release's bundle files replace this script while it runs, and bash
# reads a script as it goes: run from a copy.
if [ -z "${UPDATE_FROM_COPY:-}" ]; then
	copy="$(mktemp)"
	cp "$0" "$copy"
	UPDATE_FROM_COPY=1 UPDATE_DIR="$DIR" exec bash "$copy" "$@"
fi
cd "${UPDATE_DIR:-$DIR}"
umask 077

CREDENTIALS=data/secrets/auth/enrollment-key.json.registry.json
COSIGN_IMAGE=ghcr.io/sigstore/cosign/cosign:v2.4.1
# The release workflow of hoandat-auth; GitHub Actions' OIDC issuer.
SIGNER_OWNER="${SIGNER_OWNER:-achoo254}"
SIGNER_IDENTITY="^https://github.com/$SIGNER_OWNER/hoandat-auth/\\.github/workflows/selfhosted-release\\.yml@"
SIGNER_ISSUER=https://token.actions.githubusercontent.com
IMAGES=(nginx auth localman tunelo chat)

[ -f "$CREDENTIALS" ] || { echo "update: not enrolled yet ($CREDENTIALS missing)" >&2; exit 1; }
field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" "$CREDENTIALS"; }
REGISTRY="$(field registry)"
USERNAME="$(field username)"
[ -n "$REGISTRY" ] && [ -n "$USERNAME" ] || { echo "update: unreadable $CREDENTIALS" >&2; exit 1; }

# Docker credentials in a private config dir, also mounted for cosign.
export DOCKER_CONFIG="$PWD/data/docker"
mkdir -p "$DOCKER_CONFIG"
field password | docker login "$REGISTRY" --username "$USERNAME" --password-stdin >/dev/null

# The registry's answer for one path, authenticated through a config on a
# pipe (never in argv).
registry_get() { # path [curl args...]
	local path="$1" password
	shift
	password="$(field password)"
	curl -fsS --config <(printf 'user = "%s:%s"\n' "$USERNAME" "$password") \
		"$@" "https://$REGISTRY/v2/$path"
}

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
	VERSION="$(registry_get selfhosted-bundle/tags/list |
		grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"' | sort -V | tail -n 1)"
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "update: no release version found" >&2; exit 1; }
echo "update: release $VERSION"

# The digest a tag names now; everything after this uses the digest only.
digest_of() {
	registry_get "selfhosted-$1/manifests/$VERSION" -I \
		-H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' |
		tr -d '\r' | sed -n 's/^docker-content-digest: //Ip'
}
verify() { # image digest
	docker run --rm -e DOCKER_CONFIG=/docker -v "$DOCKER_CONFIG:/docker:ro" "$COSIGN_IMAGE" verify \
		--certificate-identity-regexp "$SIGNER_IDENTITY" \
		--certificate-oidc-issuer "$SIGNER_ISSUER" \
		"$REGISTRY/selfhosted-$1@$2" >/dev/null
}

NEXT=$(mktemp)
trap 'rm -f "$NEXT"' EXIT
echo "RELEASE_REGISTRY=$REGISTRY" >"$NEXT"
echo "RELEASE_VERSION=$VERSION" >>"$NEXT"
for image in "${IMAGES[@]}" bundle; do
	digest="$(digest_of "$image")"
	[[ "$digest" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo "update: selfhosted-$image:$VERSION not found" >&2; exit 1; }
	verify "$image" "$digest" || { echo "update: selfhosted-$image@$digest is not signed by the release workflow" >&2; exit 1; }
	echo "update: verified selfhosted-$image"
	name="$(printf '%s' "$image" | tr '[:lower:]' '[:upper:]')_DIGEST"
	echo "$name=$digest" >>"$NEXT"
done

# The release's bundle files over this folder's; data/ and .env stay.
bundle_digest="$(sed -n 's/^BUNDLE_DIGEST=//p' "$NEXT")"
docker pull -q "$REGISTRY/selfhosted-bundle@$bundle_digest" >/dev/null
box="$(docker create "$REGISTRY/selfhosted-bundle@$bundle_digest")"
docker cp "$box:/bundle/." .
docker rm "$box" >/dev/null

C=(docker compose -f compose.yaml -f compose.release.yaml --env-file .env)
# The base file alone reaches the running databases in either mode (local
# builds after init.sh, or a release).
BASE=(docker compose -f compose.yaml --env-file .env)
# Backups of both databases before anything changes, and how it ran.
stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "data/backups/$stamp"
"${BASE[@]}" exec -T mongo mongodump --archive --gzip >"data/backups/$stamp/mongo.archive.gz"
"${BASE[@]}" exec -T postgres pg_dump -U chat -Fc chat >"data/backups/$stamp/chat.pgdump"
if [ -f release.env ]; then cp release.env "data/backups/$stamp/release.env"; fi
echo "update: backed up to data/backups/$stamp"

healthy() {
	sleep 30
	local state
	state="$("${C[@]}" --env-file release.env ps --format '{{.Service}} {{.State}} {{.Health}}' nginx auth localman tunelo chat)"
	# Every service running, and healthy where it has a health check.
	! printf '%s\n' "$state" | grep -qvE ' running( healthy)? *$'
}

cp "$NEXT" release.env.next
mv release.env.next release.env
"${C[@]}" --env-file release.env pull nginx auth localman tunelo chat-migrate chat
"${C[@]}" --env-file release.env up -d --remove-orphans nginx auth localman tunelo chat
if healthy; then
	echo "update: running $VERSION"
	exit 0
fi
echo "update: $VERSION did not come up healthy" >&2
if [ -f "data/backups/$stamp/release.env" ]; then
	cp "data/backups/$stamp/release.env" release.env
	"${C[@]}" --env-file release.env up -d --remove-orphans nginx auth localman tunelo chat
	echo "update: back on $(sed -n 's/^RELEASE_VERSION=//p' release.env); data backups in data/backups/$stamp" >&2
else
	# It ran local builds (init.sh) before this release.
	rm -f release.env
	"${BASE[@]}" up -d --remove-orphans nginx auth localman tunelo chat
	echo "update: back on the local builds; data backups in data/backups/$stamp" >&2
fi
exit 1
