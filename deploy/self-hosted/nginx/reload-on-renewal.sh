#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts: reloads nginx
# twice a day so a renewed certificate is served (the certbot service
# renews into the shared volume). Certificates are read at handshake by
# path, so the first one, issued after nginx started, needs no reload.
(
	while :; do
		sleep 12h
		nginx -s reload || true
	done
) &
