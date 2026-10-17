# /internal/ of localman.<domain> in a self-hosted install (ADR 0007), in
# place of the tenant block's 404: this domain is the install's primary
# one, so the IdP delivers its audit events here, over the loopback of the
# shared network namespace, like localman.hoandat.com's own rule. The API
# client proxy egresses from that loopback too, so every proxied request
# (X-Localman-Proxy) is refused first.
location /internal/ {
    if ($http_x_localman_proxy) {
        return 403;
    }
    allow 127.0.0.1;
    deny all;
    add_header X-Robots-Tag "noindex" always;
    proxy_pass http://127.0.0.1:4000;
}
