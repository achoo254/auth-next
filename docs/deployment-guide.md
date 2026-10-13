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
| `APP_CLIENT_SECRET_KEY` | ≥ 32 ký tự; Localman và Tunelo giữ cùng giá trị để tự tính secret client của từng tenant |
| `TENANT_MAX_ACTIVE` | số tenant đang phục vụ tối đa, mặc định 20 (đo 2026-10-13: mỗi runtime rỗi thêm khoảng 0,4 MB RSS; 50 runtime thêm 21 MB) |
| `INTERNAL_API_CREDENTIALS` | `localman:<secret>,tunelo:<secret>,provisioner:<secret>` (≥ 32 ký tự mỗi secret); thiếu thì API nội bộ tắt |
| `INTERNAL_HOST`, `INTERNAL_PORT` | API nội bộ, mặc định `127.0.0.1:4501`, chỉ nhận địa chỉ loopback |
| `SERVICE_IPV4` | IP công khai của máy; có thì cứ 6 giờ kiểm lại TXT `_auth-claim.<d>` và bản ghi A của mọi host tenant, sai 3 lần liền thì tenant `suspended` |

**Backup khoá (bắt buộc trước khi có tenant thứ hai):** chép `TENANT_SECRETS_KEY` vào thư mục secret ngoài server (mục "Nơi lưu secret"). Mất khoá thì mọi tenant mất khoá ký, OAuth và bot; backup database không đủ để khôi phục.

**Xoay `TENANT_SECRETS_KEY`:** thêm khoá mới **lên đầu** (`k2:<mới>,k1:<cũ>`), restart; secret ghi sau đó dùng khoá mới, secret cũ vẫn mở bằng khoá cũ. Chỉ bỏ khoá cũ khi mọi secret đã được ghi lại.

**nginx:** block của host nào cũng có `location /internal { return 404; }` (đã có trong `infra/nginx/auth.hoandat.com.conf`); API nội bộ không bao giờ được proxy.

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
