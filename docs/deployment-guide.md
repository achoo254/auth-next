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

Ảnh của trang `/guide/domain` nằm trong `static/img/guide/` và đi theo deploy. Đổi giao diện `/claim` hay `/admin` thì chụp lại bằng `pnpm guide:screenshots` (dữ liệu mẫu, tự che giá trị TXT) trước khi deploy; ảnh của Cloudflare, GitHub, Google ở `common/` chụp tay, che email, ID, domain thật trước khi lưu.

## Chuyển sang dữ liệu có tenant (ADR 0006)

Bản đầu tiên có tenant deploy theo thứ tự này (lệnh trên server chạy trong `/var/www/hoandat-auth`):

1. Backup: `infra/backup-auth-db.sh`.
2. Deploy như thường (`infra/deploy.sh`). Sau khi cài dependency (bản này thêm `tldts`) và **trước** `pm2 startOrReload`, script chạy `node --env-file=.env dist/create-tenant-indexes.mjs`: tạo chỉ mục ghép theo tenant, in thời gian, lần sau không đổi gì. Script lỗi thì deploy dừng trước khi reload, process cũ chạy tiếp.
3. Khi khởi động, server tự gắn `tenantId` cho document cũ, gỡ chỉ mục unique toàn cục cũ và chỉ phục vụ khi không còn document nào chưa gắn (log `Tagged pre-tenant documents`, `Dropped single-tenant indexes`). Kiểm lại bằng `node --env-file=.env dist/backfill-tenant-id.mjs --dry-run`: mọi dòng phải `0 untagged`.
4. Kiểm: Localman và Tunelo đăng nhập, refresh, token exchange; `node --env-file=.env dist/seed-clients.mjs`; số restart pm2 trước và 15 phút sau.

`.env` production không cần thêm gì: `TENANT_DOMAIN` mặc định `hoandat.com`, `TENANT_DISPLAY_NAME` mặc định `Auth Next` (tên sản phẩm; hoandat.com chỉ là một tenant, từ 19/10/2026, trước đó `hoandat`). Nếu `.env` đã đặt `TENANT_DOMAIN` khác thì audience đổi ngay khi deploy: kiểm trước bằng `grep -c '^TENANT_' .env` (phải ra 0).

Lùi trước khi có tenant thứ hai: deploy lại commit trước (code cũ tạo lại chỉ mục toàn cục, vẫn đúng khi chỉ có một tenant). Sau khi có tenant thứ hai chỉ sửa tiến hoặc tạm `suspended` tenant mới (ADR 0006 mục 4): code cũ không tạo lại được chỉ mục unique toàn cục và sẽ crash-loop.

Đã chạy trên production 13/10/2026 (commit `7ae6161`, backup trước đó `auth-20261013-141933`): server gắn 126 document cũ, `backfill --dry-run` ra 0 chưa gắn ở mọi collection.

## Phục vụ tenant khác (ADR 0006)

Mặc định IdP chỉ phục vụ tenant `hoandat.com`. Bật sổ tenant bằng cặp env (đặt cả hai hoặc không đặt):

| Env | Ý nghĩa |
|---|---|
| `TENANT_SECRETS_KEY` | `kid:base64` của khoá 32 byte (`openssl rand -base64 32`), có thể nhiều khoá cách bằng dấu phẩy; khoá đầu niêm phong secret của tenant (OAuth, bot, khoá ký) bằng AES-256-GCM |
| `APP_CLIENT_SECRET_KEY` | ≥ 32 ký tự, chỉ IdP giữ; khoá riêng của Localman và Tunelo suy từ nó: `node --env-file=.env dist/app-client-key.mjs localman-web <file>` (và `tunelo-web`, `chat-web`), file mode 600, chép vào secret của app tương ứng |
| `TENANT_MAX_ACTIVE` | số tenant đang phục vụ tối đa, mặc định 20 (đo 2026-10-13: mỗi runtime rỗi thêm khoảng 0,4 MB RSS; 50 runtime thêm 21 MB) |
| `INTERNAL_API_CREDENTIALS` | `localman:<secret>,tunelo:<secret>,provisioner:<secret>,scribe:<secret>` (≥ 32 ký tự mỗi secret); thiếu thì API nội bộ tắt. Vai `scribe` chỉ gọi được `GET /internal/tenants/lookup`. Thêm Scribe: sinh secret (`openssl rand -base64 36`), nối `,scribe:<secret>` vào dòng này trong `.env` IdP, restart IdP, rồi đặt cùng giá trị cho Scribe (Basic `scribe:<secret>`) |
| `INTERNAL_HOST`, `INTERNAL_PORT` | API nội bộ, mặc định `127.0.0.1:4501`, chỉ nhận địa chỉ loopback |
| `SERVICE_IPV4` | IP công khai của máy; có thì mỗi tenant được kiểm lại 6 giờ một lần (TXT `_auth-claim.<d>`, bản ghi A của mọi host: bằng IP này, hoặc toàn IP Cloudflare khi Proxied); 3 lần sai dứt khoát liền thì `suspended`; lỗi resolver hay một lượt mọi tenant cùng sai không đình chỉ ai |

Nhận domain (`/claim` trên issuer chính) mở khi có `SERVICE_IPV4`; thêm:

| Env | Ý nghĩa |
|---|---|
| `CLAIM_BLOCKED_DOMAINS` | domain không ai được nhận (kèm mọi domain dưới nó), cách bằng dấu phẩy; mặc định `inetdev.io.vn`. Đặt mọi domain khác đang phục vụ trên máy. Domain của tenant chính luôn bị chặn |
| `CLAIM_MIN_AVAILABLE_MB` | không nhận domain mới khi `MemAvailable` dưới ngưỡng này, mặc định 300 |
| `PROVISIONER_PUBLIC_KEY_PATH` | PEM public key RSA của provisioner (phase 04); thiếu thì owner chưa lưu được token Cloudflare |
| `SELF_HOSTED_CLAIMS` | `true` thì `/claim` có thêm chế độ tự host (ADR 0007): chỉ xác minh TXT, tenant ở trạng thái `enrolling`, không có runtime, chứng chỉ hay block nginx trên máy này; mặc định `false`. Production: bật từ 17/10/2026 22:56 (`.env` cũ ở `.env.bak-261017-225624`), cùng bundle 0.2.0 |

Bản cài tự host (không phải production của hoandat.com) đổi gói enrollment khi đặt đủ ba biến: `ENROLLMENT_GATEWAY` (issuer của gateway, ví dụ `https://auth.hoandat.com`), `ENROLLMENT_BUNDLE_PATH` (tệp gói owner tải từ `/claim`), `ENROLLMENT_KEY_PATH` (khoá của bản cài, tự sinh lần đầu với mode 600; giữ tệp này qua các lần khởi động lại). `ISSUER` phải là `https://auth.<domain>` và `TENANT_DOMAIN` là domain trong gói, nếu không bản cài không khởi động. Bản cài thử đổi gói một giây sau khi chạy rồi thử lại mỗi phút cho tới khi gateway kết luận; gateway phải gọi được `https://auth.<domain>/.well-known/hoandat-enrollment`.

**Trạng thái production (13/10/2026):** đã đặt `TENANT_SECRETS_KEY` (`k1`), `APP_CLIENT_SECRET_KEY`, `INTERNAL_API_CREDENTIALS` (ba vai), `PROVISIONER_PUBLIC_KEY_PATH`, `SERVICE_IPV4=103.72.98.65` (`/claim` mở), `CLAIM_BLOCKED_DOMAINS=inet.vn,hoandat.io.vn` (`inetdev.io.vn` gỡ khỏi danh sách để chủ máy dùng làm tenant nghiệm thu). Khoá của `localman-web`/`tunelo-web` đã chép vào `.env` của Localman và Tunelo. Tenant đầu tiên: `inetdev.io.vn` (`ten_u_bsz0wGr2TR7Huk`, owner là danh tính Google của chủ máy, đăng nhập bằng GitHub OAuth App riêng của tenant), `active`.

**Backup khoá (bắt buộc trước khi có tenant thứ hai):** chép `TENANT_SECRETS_KEY` vào thư mục secret ngoài server (mục "Nơi lưu secret"). Mất khoá thì mọi tenant mất khoá ký, OAuth và bot; backup database không đủ để khôi phục.

**Xoay `TENANT_SECRETS_KEY`:** thêm khoá mới **lên đầu** (`k2:<mới>,k1:<cũ>`), restart; khi khởi động IdP niêm phong lại mọi secret còn mang khoá cũ (log `Tenant secrets re-sealed` với số lượng). Restart thêm một lần: không còn log đó nghĩa là đã xong, lúc này mới bỏ `k1`.

**nginx:** block của host nào cũng có `location /internal { return 404; }` (đã có trong `infra/nginx/auth.hoandat.com.conf`); API nội bộ không bao giờ được proxy.

## Chuyển tenant tự host (ADR 0007 §7)

Tenant `active` mà owner đã bấm chuyển (`migrating`) và đã cài bản tự host theo `docs/self-hosted-install.md`. Script nằm trong `/var/www/hoandat-auth/deploy/self-hosted/migrate/` (`infra/deploy.sh` đồng bộ thư mục này). Trên server, root, trong `/var/www/hoandat-auth`, sau khi backup ba database (`infra/backup-auth-db.sh`, backup của Localman và chat):

```bash
bash deploy/self-hosted/migrate/export-tenant.sh <domain> <migration-key.pub.json của bản cài> /root/move-<domain>
```

Script tìm chat của tenant theo `TENANT_DOMAIN` trong `/opt/chat/tenants/*.env`, niêm phong secret của IdP cùng `SESSION_KEY` của chat cho khoá của bản cài, dừng `chat-api-<id>`, rồi ghi `idp/` (mongodump theo `tenantId`, danh sách collection giữ bằng test `tenant-move-script`), `localman/` (`export-tenant.mjs` của Localman), `tunelo/`, `chat.sql` (`migrate/export-chat.sh`; bảng chat lạ thì dừng, phân loại ở `migrate/chat-tables.sh`). Cần `mongodump`, `psql`, `python3`. Chép thư mục sang bản cài qua SSH (`rsync -a`), xoá bản trên server khi owner nhập xong. Huỷ trước khi owner trỏ bản ghi A: `pm2 start chat-api-<id>` và owner bấm **Huỷ chuyển**.

Sau 14 ngày `self_hosted`: `bash deploy/self-hosted/migrate/purge-tenant.sh <domain>` (chỉ đếm), rồi thêm `--confirm` để xoá document IdP, Localman, Tunelo, hàng chat và cuối cùng secret của tenant; xong thì `pm2 delete chat-api-<id>` và xoá `/opt/chat/tenants/<id>.env`.

### Xoá tài khoản dừng giữa chừng

Xoá tài khoản (ADR 0009) khoá tài khoản trước (`disabledAt`) rồi mới xoá dữ liệu. Nếu một lượt xoá lỗi giữa chừng, tài khoản còn ở trạng thái khoá và không đăng nhập được. Sau khi backup (`infra/backup-auth-db.sh`), trong `/var/www/hoandat-auth`: `node --env-file=.env dist/finish-account-deletion.mjs <accountId>` (chỉ xem), rồi thêm `--confirm` để xoá phần còn lại. Script không gọi lại Apple hay back-channel logout.

## Provisioner chứng chỉ của tenant (ADR 0006)

Chứng chỉ của tenant do provisioner cấp (root, systemd timer 5 phút), không phải IdP. Mỗi tenant hai chứng chỉ trong config-dir riêng `/etc/letsencrypt-tenants` (tài khoản ACME riêng, không đụng chứng chỉ của hoandat): `<d>` (`auth.`, `chat.`, `localman.`, `tunnel.`; DNS-01 khi owner có token Cloudflare, để host Proxied ở mọi chế độ SSL vẫn cấp được, không có token thì HTTP-01 qua webroot `/var/lib/hoandat-tenant-acme`) và `wildcard.<d>` (DNS-01 bằng token Cloudflare của owner: `*.localman.`, `*.tunnel.`). Token chỉ nằm trong `/etc/hoandat-tenant-provisioner/credentials/<d>.ini` (600, ngoài cây chứng chỉ), không bao giờ trong argv hay log. Gia hạn: `hoandat-tenant-certbot-renew.timer` (máy chỉ có `certbot-renew.timer` cho `/etc/letsencrypt`); hai unit dùng chung `flock /etc/letsencrypt-tenants/.lock`. nginx đọc chứng chỉ theo SNI lúc bắt tay (`ssl_certificate` có biến) bằng user worker, nên `live/` và `archive/` cho nhóm của nginx đọc (750/640), `accounts/` giữ 700; chứng chỉ mới hay gia hạn không cần reload. Provisioner chạy từ bản copy root-owned `/usr/local/lib/hoandat-tenant-provisioner/` (bundle đủ dependency), không bao giờ từ cây code của IdP.

**Cài lần đầu** (khi user cho phép; máy .65 dùng chung):

1. Deploy bản có `dist/tenant-provisioner.mjs`, rồi trên server: `bash infra/provisioner/setup-provisioner.sh` (chạy lại sau mỗi deploy đổi provisioner: nó chép bundle sang thư mục root-owned). Lần đầu nó sinh cặp khoá `/etc/hoandat-tenant-provisioner/key.pem` (600) và tệp env, rồi dừng: điền `PROVISIONER_INTERNAL_SECRET` (đúng giá trị mục `provisioner` trong `INTERNAL_API_CREDENTIALS` của `.env` IdP), chạy lại để bật hai timer.
2. `.env` IdP: `PROVISIONER_PUBLIC_KEY_PATH=/var/www/hoandat-auth/secrets/provisioner.pub.pem` (script đã chép public key vào đó), restart IdP.
3. **Backup private key**: chép `/etc/hoandat-tenant-provisioner/key.pem` vào thư mục secret ngoài server (mục "Nơi lưu secret"). Mất khoá thì token DNS đã lưu không mở được nữa: owner phải nhập lại token.
4. nginx (báo user trước, cấu hình dùng chung): kiểm trước `nginx -T | grep -nE 'server_name\s+[^;]*~|default_server'` (block regex hay default server có sẵn có thể bị block tenant cạnh tranh: giữa các regex, regex đầu tiên thắng), rồi chép `infra/nginx/tenants-http.conf` thành `/etc/nginx/conf.d/00-tenants-http.conf`, `tenants-acme.conf` và `tenant-auth.conf` vào `/etc/nginx/conf.d/`, `nginx -t`, rồi `systemctl reload nginx`. Kiểm mọi host đang phục vụ vẫn trả như trước (block cụ thể luôn thắng block regex). Block tenant của Localman và Tunelo nằm ở repo `localman-next`.
5. Thử với một domain thử ở Let's Encrypt staging (`PROVISIONER_ACME=staging`, mặc định); chạy tay `systemctl start hoandat-tenant-provisioner.service`, xem `journalctl -u hoandat-tenant-provisioner`. Đạt thì đổi `PROVISIONER_ACME=production`, xoá **cả hai** chứng chỉ staging (với `C='--config-dir /etc/letsencrypt-tenants --work-dir /etc/letsencrypt-tenants/work --logs-dir /etc/letsencrypt-tenants/logs'`: `flock /etc/letsencrypt-tenants/.lock certbot delete $C --cert-name <d>` và `... --cert-name wildcard.<d>`; còn lineage staging thì `--keep-until-expiring` sẽ giữ nguyên nó), đặt lại trạng thái chứng chỉ của tenant về `pending` và kiểm `certbot renew --dry-run $C`.

**Trạng thái production (13/10/2026):** đã cài đủ 5 bước. `PROVISIONER_ACME=production`, `PROVISIONER_BLOCKED_DOMAINS=hoandat.com,inet.vn,hoandat.io.vn`; ba file nginx tenant trong `conf.d`. Thử ở staging với `inetdev.io.vn` đạt cả `<d>` (HTTP-01) lẫn `wildcard.<d>` (DNS-01), rồi chuyển production: hai chứng chỉ hiện của Let's Encrypt thật, `certbot renew --dry-run $C` đạt. Token Cloudflare có thể là token cá nhân hay token của tài khoản (`cfat_`); trang `/admin` kiểm bằng tra zone và tạo/xoá một bản ghi TXT, không gọi `/user/tokens/verify` (endpoint đó từ chối token của tài khoản).

**Host Proxied qua Cloudflare** (ADR 0006 §7): kiểm sở hữu nhận bản ghi A toàn IP Cloudflare. Chế độ Flexible đi vào cổng 80; `tenants-acme.conf` chuyển request có `X-Forwarded-Proto: https` từ dải Cloudflare tới `https://127.0.0.1:443` với SNI là host gốc. Block 443 nhận bước chuyển này (auth, chat, localman, tunnel của tenant) tự tin `127.0.0.1` ở cấp server; `00-tenants-http.conf` không tin loopback ở cấp `http` (cấu hình dùng chung, báo user trước khi cài). Kiểm sau khi cài: `curl -sI --resolve chat.<d>:80:103.72.98.65 -H 'X-Forwarded-Proto: https' http://chat.<d>/` (đi thẳng vào máy, không qua Cloudflare) vẫn trả 301; qua Cloudflare (Flexible) trả trang của app chứ không 301 lặp.

**Đổi provisioner** (`src/provisioner/`): sau deploy chạy lại `bash infra/provisioner/setup-provisioner.sh` để chép bundle mới sang thư mục root-owned; nếu không, timer vẫn chạy bản cũ. Thêm host vào chứng chỉ của tenant đã cấp: backup DB, đặt `certificate.status` của tenant về `pending` (qua `scripts/prod-mongosh.sh`); `--keep-until-expiring` thấy danh sách tên đổi nên cấp lại.

**Trạng thái production (16/10/2026):** deploy `ecea962`, chạy lại `setup-provisioner.sh`, cài ba file nginx tenant mới (bản cũ để cạnh với hậu tố `.bak-261016-150419`), backup `auth-20261016-150451` rồi đặt chứng chỉ của `inetdev.io.vn` về `pending`: chứng chỉ `<d>` cấp lại có `auth.`, `chat.`, `localman.`, `tunnel.`. `chat.inetdev.io.vn` Proxied, zone ở Flexible, trả qua Cloudflare. Secret `chat-web` của tenant đã ghi vào `/opt/chat/tenants/inetdev.env`. WebSocket của chat hỏng qua Flexible (Cloudflare RST frame từ 8 byte), nên zone có Configuration Rule đặt SSL Full (strict) cho riêng `chat.inetdev.io.vn` (ruleset phase `http_config_settings`, rule `fa7a7e76b552427ab6eca834b1c66c46`); từ 15:53 Cloudflare vào thẳng 443 của host đó, zone vẫn Flexible. 21:37 cùng ngày: cài lại `00-tenants-http.conf` và `tenant-auth.conf` (bản cũ hậu tố `.bak-261016-213715`): block auth tenant tự tin loopback và dải Cloudflare v4+v6 ở cấp server, `geo` của bước chuyển có thêm IPv6; dòng `set_real_ip_from 127.0.0.1` cấp `http` còn giữ cho block localman/tunelo. 23/10/2026 06:10: block localman/tunelo tenant tự tin loopback, cài `00-tenants-http.conf` không còn dòng đó (bản cũ `.bak-261023-061004`); request giả IP qua loopback tới `auth.hoandat.com`, `miu.hoandat.com` giờ log `127.0.0.1`.

**Tạm dừng:** `systemctl stop hoandat-tenant-provisioner.timer` (hàng đợi vẫn giữ, chạy tiếp khi bật lại). **Gỡ tenant:** đặt `certificate.status` của tenant thành `removing` (qua `scripts/prod-mongosh.sh`, sau backup); lượt sau provisioner `certbot delete` hai chứng chỉ, xoá tệp credentials và báo `removed`. Provisioner tự từ chối domain không chuẩn, domain trong `PROVISIONER_BLOCKED_DOMAINS` và hostname mà `nginx -T` đã có block khác phục vụ.

## Client của app chat

App chat (repo `chat-next`, `https://chat.hoandat.com`, pm2 `chat-api` trên cùng máy) đăng nhập qua hai client `chat-web`, `chat-mobile` (`src/oidc/chat-clients.ts`). Không có client desktop: desktop dùng Chat web dạng PWA; `chat-desktop` đã gỡ ngày 20/10/2026. Deploy và vận hành phía chat ở `chat-next/docs/deployment-guide.md`; bước đầu của nó là đặt `.env` của IdP:

| Env | Ý nghĩa |
|---|---|
| `CHAT_WEB_URL` | origin của web chat, production `https://chat.hoandat.com`; redirect và back-channel logout của `chat-web` nằm dưới nó |
| `CHAT_WEB_CLIENT_SECRET` | ≥ 32 ký tự, **bắt buộc** (thiếu thì IdP không khởi động); sinh trên server, cùng giá trị ghi vào `/opt/chat/.env` dưới tên `OIDC_CLIENT_SECRET`. Hai bên lệch nhau thì chat nhận `invalid_client` ở `/token` |
| `CHAT_MOBILE_REDIRECT_URI` | tuỳ chọn, mặc định `com.hoandat.chat:/auth/callback`; đổi khi app chat đổi `urlScheme` trong `brand.config.json` |

Tenant khác: secret của `chat-web` suy từ `APP_CLIENT_SECRET_KEY` (mục trên), không nằm trong `.env`. Trang `/apps` chỉ hiện Chat ở tenant chính cho tới khi có host `chat.<domain>` theo tenant.

Kiểm từ ngoài: IdP biết client thì chuyển lỗi "PKCE required" về đúng redirect của nó, client lạ thì không chuyển hướng:

```bash
for c in chat-web chat-mobile chat-desktop; do  # chat-desktop đã gỡ: phải in redirect rỗng
  curl -s -o /dev/null -w "$c %{redirect_url}\n" "https://auth.hoandat.com/auth?client_id=$c&response_type=code&scope=openid" | cut -d'?' -f1
done
```

**Trạng thái production (15/10/2026):** đã đặt `CHAT_WEB_URL`, `CHAT_WEB_CLIENT_SECRET` (chưa đặt `CHAT_MOBILE_REDIRECT_URI`, dùng mặc định); `/opt/chat/.env` có `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`; cả ba client có trên IdP (build 14/10/2026 15:57). API nội bộ chưa có vai `chat` (`InternalRole` trong `src/tenants/internal-auth.ts`: `localman`, `tunelo`, `provisioner`, `scribe`). 19/10/2026: deploy `84c169d` (`/account` liệt kê từng máy `chat-mobile`, `chat-desktop`), backup trước đó `auth-20261019-143353`. 20/10/2026: gỡ client `chat-desktop` trong code (desktop = PWA). 17:46 cùng ngày: deploy `0801e08` (gỡ `chat-desktop`, tên sản phẩm từ `brand.config.json`, `<meta name="description">`), backup trước đó `auth-20261020-174548` và `/root/hoandat-auth-backup-20261020-174549`; `chat-desktop` giờ trả 400 `invalid_client`, các client khác vẫn tới trang đăng nhập "Auth Next", discovery và JWKS không đổi. Rollback: deploy lại `34c70a1`.

## Client của app Scribe

App Scribe (repo `scribe-next`, thư mục local `one-scribe`, `https://scribe.hoandat.com`, systemd trên cùng máy) đăng nhập qua `scribe-web` (confidential, BFF: backend đổi code, cookie phiên của Scribe), `scribe-mobile` (public native, scheme riêng) và `scribe-web-dev` (tuỳ chọn, chỉ cho dev local) — `src/oidc/scribe-clients.ts`. **Chỉ tenant chính** có các client này; không có secret dẫn xuất theo tenant.

| Env | Ý nghĩa |
|---|---|
| `SCRIBE_WEB_URL` | origin của Scribe, mặc định `https://scribe.hoandat.com`; redirect `/api/auth/callback`, back-channel `/api/auth/backchannel-logout` |
| `SCRIBE_WEB_CLIENT_SECRET` | tuỳ chọn, ≥ 32 ký tự; có thì bật `scribe-web` + `scribe-mobile` và thẻ Scribe ở `/apps`; thiếu thì không có client web và IdP vẫn khởi động. Cùng giá trị ở tệp secret OIDC của Scribe |
| `SCRIBE_MOBILE_REDIRECT_URI` | tuỳ chọn, mặc định `com.hoandat.scribe:/auth/callback`; phải trùng URL scheme của app iPhone |
| `SCRIBE_WEB_DEV_URL` + `SCRIBE_WEB_DEV_CLIENT_SECRET` | đặt cả hai hoặc không: bật `scribe-web-dev` (redirect loopback, cổng khớp chính xác, vd `http://localhost:5174/api/auth/callback`, không back-channel) và `scribe-mobile`, để thử dev local + iOS simulator trước khi site prod có |

Kiểm từ ngoài (cùng cách như chat): `for c in scribe-web scribe-mobile scribe-web-dev; do curl -s -o /dev/null -w "$c %{redirect_url}\n" "https://auth.hoandat.com/auth?client_id=$c&response_type=code&scope=openid" | cut -d'?' -f1; done`.

**Trạng thái production (16/10/2026):** deploy commit `e1a7c96`; `.env` có `SCRIBE_WEB_DEV_URL=http://localhost:5174` + `SCRIBE_WEB_DEV_CLIENT_SECRET` (bản sao ở máy dev của chủ sở hữu, `~/.onescribe-dev/.oidc-web-dev-secret`) ⟹ `scribe-web-dev`, `scribe-mobile` đang bật; `SCRIBE_WEB_CLIENT_SECRET` chưa đặt (bật khi `scribe.hoandat.com` có site, Phase 7b của plan Scribe).

## Client của Miu World

Miu World (repo `miu-world-next`, `https://miu.hoandat.com`, game cho mọi lứa tuổi, phụ huynh đăng nhập) dùng `miu-web` (confidential, BFF: server Miu đổi code rồi cấp phiên riêng của Miu), `miu-mobile` (public native cho app iPhone/Android, scheme `com.hoandat.miu`) và `miu-web-dev` (tuỳ chọn, chỉ cho dev local) — `src/oidc/miu-clients.ts`. **Chỉ tenant chính** có các client này. Scope chỉ `openid email`, chỉ grant `authorization_code`: không có refresh token, Miu không giữ token nào của IdP sau khi đăng nhập.

| Biến | Ý nghĩa |
|---|---|
| `MIU_WEB_URL` | origin của Miu, mặc định `https://miu.hoandat.com`; redirect `/api/auth/callback`, back-channel `/api/auth/backchannel-logout`, post-logout `/` |
| `MIU_WEB_CLIENT_SECRET` | tuỳ chọn, ≥ 32 ký tự; có thì bật `miu-web` + `miu-mobile` và thẻ Miu World ở `/apps`; thiếu thì không có client Miu và IdP vẫn khởi động. Cùng giá trị ở env server Miu (`OIDC_WEB_CLIENT_SECRET` phía Miu) |
| `MIU_MOBILE_REDIRECT_URI` | tuỳ chọn, mặc định `com.hoandat.miu:/auth/callback`; phải trùng `urlScheme` trong `brand.config.json` của Miu |
| `MIU_WEB_DEV_URL` + `MIU_WEB_DEV_CLIENT_SECRET` | đặt cả hai hoặc không: bật `miu-web-dev` (redirect loopback cổng khớp chính xác, vd `http://localhost:5173/api/auth/callback` qua proxy Vite, không back-channel) và `miu-mobile` |

Bật trên production (không in secret ra terminal):

1. Backup như mục "Các lần sau", deploy commit có `miu-clients.ts`.
2. Sinh secret thẳng vào `.env` của IdP: `printf 'MIU_WEB_CLIENT_SECRET=%s\n' "$(openssl rand -base64 48 | tr -d '\n')" >> /var/www/hoandat-auth/.env` (kiểm chỉ có một dòng `MIU_WEB_CLIENT_SECRET`: `grep -c '^MIU_WEB_CLIENT_SECRET=' .env`). Chép cùng giá trị sang env của server Miu (đọc tệp, không echo) và lưu bản sao ở iCloud access-tokens.
3. `pm2 startOrReload infra/ecosystem.config.cjs --update-env`, `curl -fsS https://auth.hoandat.com/healthz`, `pnpm seed:clients` (phải liệt kê `miu-web "Miu World"`, back-channel `https://miu.hoandat.com/api/auth/backchannel-logout`, `miu-mobile` redirect `com.hoandat.miu:/auth/callback`).
4. Kiểm từ ngoài (như Scribe): `for c in miu-web miu-mobile; do curl -s -o /dev/null -w "$c %{redirect_url}\n" "https://auth.hoandat.com/auth?client_id=$c&response_type=code&scope=openid" | cut -d'?' -f1; done` phải in `https://miu.hoandat.com/api/auth/callback` và `com.hoandat.miu:/auth/callback`.

Rollback: xoá dòng `MIU_WEB_CLIENT_SECRET` rồi reload; IdP không còn client Miu (Miu sẽ báo đăng nhập không khả dụng).

## App iOS "Tài khoản" (`account-ios`, AASA, APNs)

Client `account-ios` (`src/oidc/account-ios-client.ts`) và API `/api/account` có sẵn ở tenant chính, không cần biến nào: chưa có app thì không ai dùng. Hai phần tuỳ chọn, bật khi phase 00 của plan `261020-0742-ios-account-app` xong (App ID `com.hoandat.account` với Push Notifications và Associated Domains):

| Biến | Ý nghĩa |
|---|---|
| `IOS_APP_ID` | `<TEAMID>.com.hoandat.account`. Có thì `https://auth.hoandat.com/.well-known/apple-app-site-association` trả JSON (`applinks` cho `/ios/callback`, `/ios/linked`; `webcredentials`); thiếu thì 404 và universal link không mở app |
| `APNS_KEY_PATH` | khoá APNs `.p8` (EC P-256), file secret read-only, vd `/var/www/hoandat-auth/secrets/apns-auth-key.p8` (600). Sai file thì IdP không khởi động, báo tên biến, không in nội dung |
| `APNS_KEY_ID` | Key ID 10 ký tự của khoá đó |
| `APNS_TEAM_ID` | Team ID 10 ký tự |
| `APNS_TOPIC` | bundle id của app: `com.hoandat.account` |

Bốn biến `APNS_*` đi cùng nhau; thiếu biến nào thì thông báo đẩy tắt (log cảnh báo nếu đặt dở), `PUT /api/account/push-device` vẫn trả `204` nhưng không lưu token, IdP chạy như cũ. Host APNs chọn theo `environment` mỗi thiết bị gửi lên: `sandbox` → `api.sandbox.push.apple.com` (build chạy từ Xcode), `production` → `api.push.apple.com` (TestFlight, App Store). Một khoá token-based dùng được cho cả hai.

Bật trên production (không in secret ra terminal):

1. Ở Apple Developer → Certificates, IDs & Profiles → Keys: tạo khoá có "Apple Push Notifications service (APNs)", tải `AuthKey_<KEYID>.p8` (chỉ tải được một lần; bản sao ở iCloud access-tokens). Ghi Key ID và Team ID.
2. Backup DB như mục "Các lần sau", deploy commit có `src/push/`.
3. Chép khoá lên máy: `install -m 600 -o <user pm2> AuthKey_<KEYID>.p8 /var/www/hoandat-auth/secrets/apns-auth-key.p8`.
4. Thêm vào `.env`: `IOS_APP_ID=<TEAMID>.com.hoandat.account`, `APNS_KEY_PATH=/var/www/hoandat-auth/secrets/apns-auth-key.p8`, `APNS_KEY_ID=<KEYID>`, `APNS_TEAM_ID=<TEAMID>`, `APNS_TOPIC=com.hoandat.account`.
5. `pm2 startOrReload infra/ecosystem.config.cjs --update-env`, `curl -fsS https://auth.hoandat.com/healthz`, `curl -fsS https://auth.hoandat.com/.well-known/apple-app-site-association` (phải là JSON có đúng app id, không redirect), `pnpm seed:clients` (phải có `account-ios` redirect `https://auth.hoandat.com/ios/callback https://auth.hoandat.com/ios/linked`).
6. Nginx: `/.well-known/apple-app-site-association`, `/ios/*` và `/api/account*` đi thẳng tới IdP như mọi path khác (không chặn, không redirect, không cache ở Cloudflare cho `/api/account`). Apple tải AASA qua CDN của nó; đổi `IOS_APP_ID` có thể mất tới 24 giờ mới tới máy.

Collection mới `push_devices` (có `tenantId`, unique `{tenantId, token}`, TTL `expiresAt`) tự tạo chỉ mục khi khởi động. Rollback: xoá các biến `APNS_*` (tắt đẩy) và `IOS_APP_ID` (tắt universal link) rồi reload; gỡ hẳn client thì revert commit (grant `account-ios` còn lại vô hiệu).

## Tuỳ chọn bật sau

- Sign in with Apple (ADR 0008): code có sẵn, **chưa bật** (19/10/2026, chờ Apple duyệt tài khoản developer). Bật theo [`sign-in-with-apple.md`](sign-in-with-apple.md): khoá `.p8` ở `/var/www/hoandat-auth/secrets/apple-signin-key.p8` (600), bốn biến `APPLE_*` + `APPLE_PRIMARY_APP_ID` trong `.env`.
- Google/GitHub (đã bật 2026-10-09): GitHub OAuth App "hoandat · Tài khoản" (owner `achoo254`, app id 3916221); Google Cloud project `hoandat-auth`, Google Auth Platform ở trạng thái "In production" (External), web client `auth.hoandat.com`. Callback lần lượt `https://auth.hoandat.com/oauth/github/callback` và `/oauth/google/callback`. Google bắt buộc link chính sách quyền riêng tư `https://auth.hoandat.com/privacy` trước khi publish.
- Telegram (đã bật 2026-10-09 với `@auth_hoandat_bot`): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` nằm trong `.env`; webhook `https://auth.hoandat.com/telegram/webhook` đặt bằng `setWebhook` với `secret_token` và `allowed_updates=["message","callback_query"]`. Khi xoay token: cập nhật `.env`, restart, đặt lại webhook.
- Audit sang Localman: điền `AUDIT_EVENTS_URL`, `AUDIT_CLIENT_ID`, `AUDIT_CLIENT_SECRET` khi Localman có endpoint.

## Số liệu tăng trưởng (ADR 0011)

Collection `client_usage` (có `tenantId`, TTL 400 ngày trên `at`) tự tạo chỉ mục khi khởi động, hoặc trước đó bằng `dist/create-tenant-indexes.mjs`. Cập nhật `/privacy` đi cùng bản này. Đọc số liệu trong `/var/www/hoandat-auth`: `node --env-file=.env dist/growth-report.mjs` (8 tuần, mọi tenant), thêm `--weeks N`, `--tenant <id>`, `--json`. Script chỉ đọc. Có sự cố thì đặt `CLIENT_USAGE_ENABLED=false` trong `.env` rồi `pm2 startOrReload infra/ecosystem.config.cjs --update-env`; dữ liệu đã ghi tự hết theo TTL.

## Đăng nhập cho người duyệt ứng dụng (ADR 0010)

Tắt mặc định; chỉ bật trong thời gian App Store duyệt app (tài khoản demo theo Guideline 2.1), chỉ ở tenant chính.

**Bật**

1. Sinh hash trên máy chủ sở hữu, mật khẩu đi qua stdin (không bao giờ là tham số) và hash đi thẳng vào file trên server, không lưu tạm:

   ```bash
   printf '%s' "$REVIEW_PASSWORD" | pnpm -s review-login:hash \
     | ssh -p 24700 <user>@103.72.98.65 'umask 077; cat > /var/www/hoandat-auth/secrets/review-login.hash'
   ssh -p 24700 <user>@103.72.98.65 'chmod 600 /var/www/hoandat-auth/secrets/review-login.hash && ls -l /var/www/hoandat-auth/secrets/review-login.hash'
   ```

   File phải mode 600 và thuộc user chạy pm2 (`<user>` ở trên); thư mục `secrets/` không bị `infra/deploy.sh` đồng bộ. Mật khẩu dài 12–256 ký tự.
2. Thêm vào `/var/www/hoandat-auth/.env`:

   ```dotenv
   REVIEW_LOGIN_EMAIL=<email ghi trong App Review notes>
   REVIEW_LOGIN_PASSWORD_HASH_PATH=/var/www/hoandat-auth/secrets/review-login.hash
   ```

   Hai biến đi cùng nhau; thiếu một biến, email sai dạng, file đọc được bởi group/other hoặc không phải hash thì IdP không khởi động và báo tên biến (không in nội dung). Email không được là email của một tài khoản thật (đăng nhập sẽ bị từ chối).
3. `pm2 startOrReload infra/ecosystem.config.cjs --update-env`, `curl -fsS https://auth.hoandat.com/healthz`, `pm2 logs hoandat-auth --lines 50 --nostream`. Kiểm: trang đăng nhập có link "Tài khoản dành cho người duyệt ứng dụng"; đăng nhập bằng email + mật khẩu đó vào app Scribe được. Lần đầu tạo tài khoản `app_review` ("App Review", email chưa xác minh).
4. Ghi email và mật khẩu vào App Review Information (Sign-in required) trên App Store Connect.

Lần sai: 5 lần/IP/15 phút, 30 lần/giờ cho mọi IP; mỗi lần ghi `login.failed` (audit) và log `Review sign-in failed`.

**Trạng thái production (20/10/2026 11:05):** deploy `2199161` (kèm `8cd497f` Apple chưa bật, `9714b07`, `2de2bd5` xoá tài khoản), backup trước đó `auth-20261020-110303` và `/root/hoandat-auth-backup-20261020-110302` (dist, static, `.env` cũ). Đã bật: `REVIEW_LOGIN_EMAIL=appreview@hoandat.com`, tệp hash 600 (root); mật khẩu ở iCloud access-tokens, service `apple-app-review-demo`. pm2 restart 56 → 57, log lỗi trống; mọi client (`scribe-web`, `scribe-mobile`, `localman-web`, `chat-web`, `tunelo-web`) vẫn chuyển hướng đúng. Rollback: deploy lại `84c169d`. 11:19 cùng ngày: deploy `34c70a1` (vai `scribe` của API nội bộ, chỉ `GET /internal/tenants/lookup`); `INTERNAL_API_CREDENTIALS` thêm `scribe:<secret>` (bản `.env` trước: `/root/hoandat-auth-env.bak-20261020-111903`; secret ở iCloud access-tokens `hoandat-auth-internal-scribe`, phía Scribe `/opt/scribe-be/.idp-internal-secret`), backup `auth-20261020-111922`; lookup `scribe.hoandat.com` trả `Auth Next`, route khác trả 401 cho vai này.

**Tắt** (sau khi app được duyệt): xoá hai dòng `REVIEW_LOGIN_*` khỏi `.env`, restart như bước 3, xoá `secrets/review-login.hash`. Link biến mất, `/interaction/:uid/review` trả 404; tài khoản `app_review` còn nhưng không còn cách đăng nhập (xoá ở `/account` trước khi tắt nếu không cần giữ).

## Xoay khoá ký

`node dist/generate-signing-key.mjs secrets/signing-keys.json [--alg ES256|RS256]` thêm khoá mới ở cuối (mặc định ES256). Khoá đầu tiên **của mỗi thuật toán** ký, nên khoá mới chỉ để xác minh nếu file đã có khoá cùng thuật toán. Sau khi các app đã cache JWKS mới, chuyển khoá đó lên trước các khoá cùng thuật toán và restart. Xem ADR 0001 mục 4 và ADR 0005.

Discovery phải quảng bá cả `ES256` và `RS256` cho ID token (OpenID Connect Discovery bắt buộc RS256); `node dist/seed-clients.mjs` báo lỗi nếu thiếu. Xoá khoá RSA khỏi file thì RS256 tự biến khỏi discovery sau restart.

## Nơi lưu secret

Ngoài server, mọi secret của IdP (Google/GitHub client, bot Telegram, admin MongoDB, bản sao `.env`) nằm ở thư mục iCloud `ENV production/auth-hoandat/secrets.json` của chủ sở hữu, không bao giờ vào repo. Từ 13/10/2026 (theo yêu cầu của chủ sở hữu) thư mục `ENV production/auth-hoandat/server/` giữ bản sao nguyên văn các tệp trên server, mode 600: `hoandat-auth.env` (có `TENANT_SECRETS_KEY`, `APP_CLIENT_SECRET_KEY`, `INTERNAL_API_CREDENTIALS`), `signing-keys.json` (khoá ký riêng), `provisioner-key.pem`, `provisioner-key.pub.pem`, `provisioner.env`, và token Cloudflare giới hạn zone `inetdev.io.vn` (`cloudflare-dns-inetdev.io.vn.token`); `.env` của Localman và Tunelo ở `ENV production/localman/server/`, `ENV production/tunelo/server/`. Chép lại sau mỗi lần đổi khoá hay `.env` (chép qua `ssh cat` vào tệp 600, so sha256 hai đầu, không in nội dung).

## Rollback

`pm2 stop hoandat-auth` và xoá file nginx của site (rồi `nginx -t` và reload). Database `auth` độc lập với các app khác; khôi phục từ backup: `mongorestore --gzip --archive=backups/auth-<stamp>.archive.gz --nsInclude='auth.*' --drop` với URI của user `auth`.
