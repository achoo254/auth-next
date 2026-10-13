# Deploy auth.hoandat.com

IdP chạy trên server dùng chung `103.72.98.65` theo quy ước của server đó: process pm2 ở `/var/www/hoandat-auth`, nginx một file cho mỗi hostname, MongoDB native dùng chung (mỗi app một database và một user). Không dùng Docker Compose trên server này vì máy từng thiếu RAM và mongod đã giữ cổng 27017 (Jev `jev-1.13.0`, 1.00). `Dockerfile` và `docker-compose.yml` vẫn dùng được cho chạy local hoặc host khác.

## Thành phần

| Thành phần | Vị trí |
|---|---|
| DNS | Cloudflare, bản ghi `A auth.hoandat.com → 103.72.98.65`, proxied; zone `hoandat.com` để SSL mode "full" |
| TLS phía origin | chứng chỉ tự ký dùng chung `/etc/pki/nginx/server.{crt,key}` (Cloudflare "full" chấp nhận) |
| nginx | `/etc/nginx/conf.d/auth.hoandat.com.conf`, bản gốc ở `infra/nginx/` |
| IP client thật | `set_real_ip_from` của Cloudflare đã đặt ở cấp `http` trên server; site chỉ chuyển `X-Forwarded-For $remote_addr`, IdP tin proxy `127.0.0.1` (`TRUST_PROXY=127.0.0.1`) |
| Process | pm2 `hoandat-auth`, `infra/ecosystem.config.cjs`, cổng `127.0.0.1:4500` |
| Cấu hình | `/var/www/hoandat-auth/.env` (mode 600, sinh bởi `infra/setup-server.sh`, không bao giờ sync từ máy dev) |
| Khoá ký | `/var/www/hoandat-auth/secrets/signing-keys.json` (mode 600, sinh trên server): một khoá EC ES256 ký mọi token theo mặc định, một khoá RSA RS256 cho ID token của client khai RS256 (ADR 0005) |
| Database | database `auth`, user `auth` chỉ có `readWrite` trên `auth` |
| Backup | `infra/backup-auth-db.sh`, cron 02:30 hằng ngày, giữ 14 ngày trong `/var/www/hoandat-auth/backups` |

Access log của nginx che token trong đường dẫn `/reset/...` (link đặt lại mật khẩu cũ; route đã bỏ theo ADR 0004 nhưng link cũ còn trong chat Telegram).

## Lần đầu

1. DNS: tạo bản ghi ở trên (proxied).
2. Đồng bộ bản build: `SSH_TARGET=<alias> bash infra/deploy.sh`. Bước restart sẽ báo lỗi ở lần đầu vì chưa có `.env`; đó là bình thường.
3. Trên server, trong `/var/www/hoandat-auth`: `bash infra/setup-server.sh` (sinh khoá ký và `.env` với secret ngẫu nhiên; chạy lại không ghi đè).
4. Tạo user MongoDB bằng một user quản trị (trên .65 là `hoandat_admin`, thông tin nằm ở mục `SSH_SERVER_STAGING` của file server ngoài repo) (mật khẩu đọc từ stdin, không lộ qua argv):
   `bash infra/create-mongo-user.sh <admin-user> < <file-chứa-mật-khẩu-admin>`
5. nginx: chép `infra/nginx/auth.hoandat.com.conf` vào `/etc/nginx/conf.d/`, chạy `nginx -t`, rồi `systemctl reload nginx`.
6. Chạy lại `infra/deploy.sh` để khởi động pm2 và kiểm `/healthz`.
7. Cron backup: `30 2 * * * /var/www/hoandat-auth/infra/backup-auth-db.sh >> /var/log/hoandat-auth-backup.log 2>&1`.
8. Kiểm cấu hình client: `node --env-file=.env dist/seed-clients.mjs` (chỉ đọc).

## Các lần sau

```bash
SSH_TARGET=<alias> [SSH_OPTS="-F ssh_config"] bash infra/deploy.sh
```

Script build, rsync `dist/ static/ infra/ package.json pnpm-lock.yaml pnpm-workspace.yaml` (chủ sở hữu `root`), cài dependency production bằng pnpm 11.9, `pm2 startOrReload`, `pm2 save`, rồi đợi `/healthz`.

## Chuyển sang dữ liệu có tenant (ADR 0006)

Bản đầu tiên có tenant deploy theo thứ tự này (lệnh trên server chạy trong `/var/www/hoandat-auth`):

1. Backup: `infra/backup-auth-db.sh`.
2. Deploy như thường (`infra/deploy.sh`). Sau khi cài dependency (bản này thêm `tldts`) và **trước** `pm2 startOrReload`, script chạy `node --env-file=.env dist/create-tenant-indexes.mjs`: tạo chỉ mục ghép theo tenant, in thời gian, lần sau không đổi gì. Script lỗi thì deploy dừng trước khi reload, process cũ chạy tiếp.
3. Khi khởi động, server tự gắn `tenantId` cho document cũ, gỡ chỉ mục unique toàn cục cũ và chỉ phục vụ khi không còn document nào chưa gắn (log `Tagged pre-tenant documents`, `Dropped single-tenant indexes`). Kiểm lại bằng `node --env-file=.env dist/backfill-tenant-id.mjs --dry-run`: mọi dòng phải `0 untagged`.
4. Kiểm: Localman và Tunelo đăng nhập, refresh, token exchange; `node --env-file=.env dist/seed-clients.mjs`; số restart pm2 trước và 15 phút sau.

`.env` production không cần thêm gì: `TENANT_DOMAIN` mặc định `hoandat.com`, `TENANT_DISPLAY_NAME` mặc định `hoandat`. Nếu `.env` đã đặt `TENANT_DOMAIN` khác thì audience đổi ngay khi deploy: kiểm trước bằng `grep -c '^TENANT_' .env` (phải ra 0).

Lùi trước khi có tenant thứ hai: deploy lại commit trước (code cũ tạo lại chỉ mục toàn cục, vẫn đúng khi chỉ có một tenant). Sau khi có tenant thứ hai chỉ sửa tiến hoặc tạm `suspended` tenant mới (ADR 0006 mục 4): code cũ không tạo lại được chỉ mục unique toàn cục và sẽ crash-loop.

## Phục vụ tenant khác (ADR 0006)

Mặc định IdP chỉ phục vụ tenant `hoandat.com`. Bật sổ tenant bằng cặp env (đặt cả hai hoặc không đặt):

| Env | Ý nghĩa |
|---|---|
| `TENANT_SECRETS_KEY` | `kid:base64` của khoá 32 byte (`openssl rand -base64 32`), có thể nhiều khoá cách bằng dấu phẩy; khoá đầu niêm phong secret của tenant (OAuth, bot, khoá ký) bằng AES-256-GCM |
| `APP_CLIENT_SECRET_KEY` | ≥ 32 ký tự, chỉ IdP giữ; khoá riêng của Localman và Tunelo suy từ nó: `node --env-file=.env dist/app-client-key.mjs localman-web <file>` (và `tunelo-web`), file mode 600, chép vào secret của app tương ứng |
| `TENANT_MAX_ACTIVE` | số tenant đang phục vụ tối đa, mặc định 20 (đo 2026-10-13: mỗi runtime rỗi thêm khoảng 0,4 MB RSS; 50 runtime thêm 21 MB) |
| `INTERNAL_API_CREDENTIALS` | `localman:<secret>,tunelo:<secret>,provisioner:<secret>` (≥ 32 ký tự mỗi secret); thiếu thì API nội bộ tắt |
| `INTERNAL_HOST`, `INTERNAL_PORT` | API nội bộ, mặc định `127.0.0.1:4501`, chỉ nhận địa chỉ loopback |
| `SERVICE_IPV4` | IP công khai của máy; có thì mỗi tenant được kiểm lại 6 giờ một lần (TXT `_auth-claim.<d>`, bản ghi A của mọi host); 3 lần sai dứt khoát liền thì `suspended`; lỗi resolver hay một lượt mọi tenant cùng sai không đình chỉ ai |

Nhận domain (`/claim` trên issuer chính) mở khi có `SERVICE_IPV4`; thêm:

| Env | Ý nghĩa |
|---|---|
| `CLAIM_BLOCKED_DOMAINS` | domain không ai được nhận (kèm mọi domain dưới nó), cách bằng dấu phẩy; mặc định `inetdev.io.vn`. Đặt mọi domain khác đang phục vụ trên máy. Domain của tenant chính luôn bị chặn |
| `CLAIM_MIN_AVAILABLE_MB` | không nhận domain mới khi `MemAvailable` dưới ngưỡng này, mặc định 300 |
| `PROVISIONER_PUBLIC_KEY_PATH` | PEM public key RSA của provisioner (phase 04); thiếu thì owner chưa lưu được token Cloudflare |

**Backup khoá (bắt buộc trước khi có tenant thứ hai):** chép `TENANT_SECRETS_KEY` vào thư mục secret ngoài server (mục "Nơi lưu secret"). Mất khoá thì mọi tenant mất khoá ký, OAuth và bot; backup database không đủ để khôi phục.

**Xoay `TENANT_SECRETS_KEY`:** thêm khoá mới **lên đầu** (`k2:<mới>,k1:<cũ>`), restart; khi khởi động IdP niêm phong lại mọi secret còn mang khoá cũ (log `Tenant secrets re-sealed` với số lượng). Restart thêm một lần: không còn log đó nghĩa là đã xong, lúc này mới bỏ `k1`.

**nginx:** block của host nào cũng có `location /internal { return 404; }` (đã có trong `infra/nginx/auth.hoandat.com.conf`); API nội bộ không bao giờ được proxy.

## Provisioner chứng chỉ của tenant (ADR 0006)

Chứng chỉ của tenant do provisioner cấp (root, systemd timer 5 phút), không phải IdP. Mỗi tenant hai chứng chỉ trong config-dir riêng `/etc/letsencrypt-tenants` (tài khoản ACME riêng, không đụng chứng chỉ của hoandat): `<d>` (HTTP-01 qua webroot `/var/lib/hoandat-tenant-acme`: `auth.`, `localman.`, `tunnel.`) và `wildcard.<d>` (DNS-01 bằng token Cloudflare của owner: `*.localman.`, `*.tunnel.`). Token chỉ nằm trong `/etc/letsencrypt-tenants/credentials/<d>.ini` (600), không bao giờ trong argv hay log. Gia hạn: `hoandat-tenant-certbot-renew.timer` (máy chỉ có `certbot-renew.timer` cho `/etc/letsencrypt`). nginx đọc chứng chỉ theo SNI lúc bắt tay (`ssl_certificate` có biến), nên chứng chỉ mới hay gia hạn không cần reload.

**Cài lần đầu** (khi user cho phép; máy .65 dùng chung):

1. Deploy bản có `dist/tenant-provisioner.mjs`, rồi trên server: `bash infra/provisioner/setup-provisioner.sh`. Lần đầu nó sinh cặp khoá `/etc/hoandat-tenant-provisioner/key.pem` (600) và tệp env, rồi dừng: điền `PROVISIONER_INTERNAL_SECRET` (đúng giá trị mục `provisioner` trong `INTERNAL_API_CREDENTIALS` của `.env` IdP), chạy lại để bật hai timer.
2. `.env` IdP: `PROVISIONER_PUBLIC_KEY_PATH=/var/www/hoandat-auth/secrets/provisioner.pub.pem` (script đã chép public key vào đó), restart IdP.
3. **Backup private key**: chép `/etc/hoandat-tenant-provisioner/key.pem` vào thư mục secret ngoài server (mục "Nơi lưu secret"). Mất khoá thì token DNS đã lưu không mở được nữa: owner phải nhập lại token.
4. nginx (báo user trước, cấu hình dùng chung): chép `infra/nginx/tenants-http.conf` thành `/etc/nginx/conf.d/00-tenants-http.conf`, `tenants-acme.conf` và `tenant-auth.conf` vào `/etc/nginx/conf.d/`, `nginx -t`, rồi `systemctl reload nginx`. Kiểm mọi host đang phục vụ vẫn trả như trước (block cụ thể luôn thắng block regex). Block tenant của Localman và Tunelo nằm ở repo `localman-next`.
5. Thử với một domain thử ở Let's Encrypt staging (`PROVISIONER_ACME=staging`, mặc định); chạy tay `systemctl start hoandat-tenant-provisioner.service`, xem `journalctl -u hoandat-tenant-provisioner`. Đạt thì đổi `PROVISIONER_ACME=production`, xoá chứng chỉ staging (`certbot delete --config-dir /etc/letsencrypt-tenants --cert-name <d>`), đặt lại trạng thái chứng chỉ của tenant về `pending` và kiểm `certbot renew --dry-run --config-dir /etc/letsencrypt-tenants`.

**Tạm dừng:** `systemctl stop hoandat-tenant-provisioner.timer` (hàng đợi vẫn giữ, chạy tiếp khi bật lại). **Gỡ tenant:** đặt `certificate.status` của tenant thành `removing` (qua `scripts/prod-mongosh.sh`, sau backup); lượt sau provisioner `certbot delete` hai chứng chỉ, xoá tệp credentials và báo `removed`. Provisioner tự từ chối domain không chuẩn, domain trong `PROVISIONER_BLOCKED_DOMAINS` và hostname mà `nginx -T` đã có block khác phục vụ.

## Tuỳ chọn bật sau

- Google/GitHub (đã bật 2026-10-09): GitHub OAuth App "hoandat · Tài khoản" (owner `achoo254`, app id 3916221); Google Cloud project `hoandat-auth`, Google Auth Platform ở trạng thái "In production" (External), web client `auth.hoandat.com`. Callback lần lượt `https://auth.hoandat.com/oauth/github/callback` và `/oauth/google/callback`. Google bắt buộc link chính sách quyền riêng tư `https://auth.hoandat.com/privacy` trước khi publish.
- Telegram (đã bật 2026-10-09 với `@auth_hoandat_bot`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` nằm trong `.env`; webhook `https://auth.hoandat.com/telegram/webhook` đặt bằng `setWebhook` với `secret_token` và `allowed_updates=["message","callback_query"]`. Khi xoay token: cập nhật `.env`, restart, đặt lại webhook.
- Audit sang Localman: điền `AUDIT_EVENTS_URL`, `AUDIT_CLIENT_ID`, `AUDIT_CLIENT_SECRET` khi Localman có endpoint.

## Xoay khoá ký

`node dist/generate-signing-key.mjs secrets/signing-keys.json [--alg ES256|RS256]` thêm khoá mới ở cuối (mặc định ES256). Khoá đầu tiên **của mỗi thuật toán** ký, nên khoá mới chỉ để xác minh nếu file đã có khoá cùng thuật toán. Sau khi các app đã cache JWKS mới, chuyển khoá đó lên trước các khoá cùng thuật toán và restart. Xem ADR 0001 mục 4 và ADR 0005.

Discovery phải quảng bá cả `ES256` và `RS256` cho ID token (OpenID Connect Discovery bắt buộc RS256); `node dist/seed-clients.mjs` báo lỗi nếu thiếu. Xoá khoá RSA khỏi file thì RS256 tự biến khỏi discovery sau restart.

## Nơi lưu secret

Ngoài server, mọi secret của IdP (Google/GitHub client, bot Telegram, admin MongoDB, bản sao `.env`) nằm ở thư mục iCloud `ENV production/auth-hoandat/secrets.json` của chủ sở hữu, không bao giờ vào repo. Khoá ký riêng chỉ nằm trên server.

## Rollback

`pm2 stop hoandat-auth` và xoá file nginx của site (rồi `nginx -t` và reload). Database `auth` độc lập với các app khác; khôi phục từ backup: `mongorestore --gzip --archive=backups/auth-<stamp>.archive.gz --nsInclude='auth.*' --drop` với URI của user `auth`.
