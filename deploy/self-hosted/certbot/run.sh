#!/bin/sh
# Certificates of a self-hosted install (ADR 0007): one Let's Encrypt
# certificate for every host of DOMAIN, wildcards included, by DNS-01 with
# the owner's Cloudflare token, then a renewal check twice a day. nginx's
# $tenant_cert map names it "<domain>" and, for subdomains of localman. and
# tunnel., "wildcard.<domain>": the same certificate under a second name.
# nginx reloads twice a day on its own (reload-on-renewal.sh).
set -eu
: "${DOMAIN:?DOMAIN is required}" "${ACME_EMAIL:?ACME_EMAIL is required}"
CREDENTIALS=/run/secrets/cloudflare.ini

if [ ! -e "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
	certbot certonly --non-interactive --agree-tos --email "$ACME_EMAIL" \
		--dns-cloudflare --dns-cloudflare-credentials "$CREDENTIALS" \
		--dns-cloudflare-propagation-seconds 30 \
		--cert-name "$DOMAIN" \
		-d "auth.$DOMAIN" -d "chat.$DOMAIN" \
		-d "localman.$DOMAIN" -d "*.localman.$DOMAIN" \
		-d "tunnel.$DOMAIN" -d "*.tunnel.$DOMAIN"
fi
ln -sfn "$DOMAIN" "/etc/letsencrypt/live/wildcard.$DOMAIN"

while :; do
	sleep 12h
	certbot renew --quiet --dns-cloudflare-credentials "$CREDENTIALS" || true
done
