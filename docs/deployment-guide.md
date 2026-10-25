# Deploy auth.hoandat.com

IdP chạy trên server dùng chung `<SERVER_65_IP>` theo quy ước của server đó: process pm2 ở `/var/www/hoandat-auth`, nginx một file cho mỗi hostname, MongoDB native dùng chung (mỗi app một database và một user). Không dùng Docker Compose trên server này vì máy từng thiếu RAM và mongod đã giữ cổng 27017 (Jev `jev-1.13.0`, 1.00). `Dockerfile` và `docker-compose.yml` vẫn dùng được cho chạy local hoặc host khác.

## Thành phần

| Thành phần | Vị trí |
|---|---|
| DNS | Cloudflare, bản ghi `A auth.hoandat.com → <SERVER_65_IP>`, proxied; zone `hoandat.com` để SSL mode "full" |
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

## Dữ liệu có `tenantId` (ADR 0006, 0013)

Mọi document của IdP mang `tenantId`, giá trị luôn `primary` (tenant duy nhất, dựng từ env). Chỉ mục ghép dẫn đầu bằng `tenantId` do `infra/deploy.sh` tạo trước khi reload (`node --env-file=.env dist/create-indexes.mjs`, idempotent, in thời gian từng nhóm); script lỗi thì deploy dừng trước reload, process cũ chạy tiếp. Server không còn tự gắn `tenantId` cho document cũ lúc khởi động: lần chuyển dữ liệu đã chạy trên production 13/10/2026 (commit `7ae6161`, backup trước đó `auth-20261013-141933`, gắn 126 document cũ, không còn document nào chưa gắn).

`.env` production không đặt `TENANT_DOMAIN` (mặc định `hoandat.com`) hay `TENANT_DISPLAY_NAME` (mặc định `Auth Next`, từ 19/10/2026, trước đó `hoandat`). Đặt `TENANT_DOMAIN` khác thì audience đổi ngay khi deploy: kiểm trước bằng `grep -c '^TENANT_' .env` (phải ra 0).

## Gỡ đa tenant (ADR 0013)

Bản gỡ tenant theo domain, tự host và Scribe trên tenant: IdP chỉ dựng runtime `primary` từ env, không còn `/claim`, `/admin`, `/guide/domain`, `/.well-known/hoandat-enrollment`, API nội bộ (cổng `4501`) hay provisioner. Thứ tự: deploy code, rồi gỡ env, rồi gỡ nginx và file trên server.

1. Backup `dist`, `static`, `package.json`, `.env` và database (`infra/backup-auth-db.sh`) vào thư mục backup ngoài vòng xoay, rồi `infra/deploy.sh`. `rsync --delete` tự gỡ khỏi `/var/www/hoandat-auth` các file đã xoá trong `dist/` và `infra/` (`infra/provisioner/`, `infra/nginx/tenant*.conf`); thư mục `deploy/` (bundle tự host cũ) không còn được đồng bộ nên phải xoá tay.
2. `.env` còn biến cũ thì IdP vẫn khởi động (schema bỏ qua biến lạ). Sau deploy, xoá khỏi `.env`: `TENANT_SECRETS_KEY`, `APP_CLIENT_SECRET_KEY`, `TENANT_MAX_ACTIVE`, `INTERNAL_API_CREDENTIALS`, `INTERNAL_HOST`, `INTERNAL_PORT`, `SERVICE_IPV4`, `PROVISIONER_PUBLIC_KEY_PATH`, `CLAIM_BLOCKED_DOMAINS`, `CLAIM_MIN_AVAILABLE_MB`, `SELF_HOSTED_CLAIMS`, `ENROLLMENT_GATEWAY`, `ENROLLMENT_BUNDLE_PATH`, `ENROLLMENT_KEY_PATH`, `SCRIBE_TENANTS`, `SCRIBE_SEALING_PUBLIC_KEY_PATH`, rồi `pm2 startOrReload infra/ecosystem.config.cjs --update-env`. Kiểm: `ss -ltnp | grep 4501` rỗng; `/claim`, `/admin`, `/.well-known/hoandat-enrollment` trả 404; discovery, JWKS và client tĩnh không đổi (`node --env-file=.env dist/seed-clients.mjs`).
3. nginx: gỡ `00-tenants-http.conf` khi `nginx -T | grep -nE '\$tenant_(cert|key)' | grep -v 'map '` rỗng; file gỡ chuyển ra ngoài `conf.d`, `nginx -t`, reload.
4. Xoá trên server: unit `hoandat-tenant-provisioner.{service,timer}`, `hoandat-tenant-certbot-renew.{service,timer}`, `/usr/local/lib/hoandat-tenant-provisioner/`, `/var/lib/hoandat-tenant-acme`, `/etc/letsencrypt-tenants`; huỷ (`shred -u`, không lưu trữ) `/etc/hoandat-tenant-provisioner/`, `secrets/provisioner.pub.pem`, `secrets/scribe-sealing.pub.pem`; xoá `/var/www/hoandat-auth/deploy/`.
5. Database: `mongodump` ngay trước, rồi đếm và drop `tenants`, `tenant_claims`, `tenant_secrets` (không còn code nào đọc; primary không có bản ghi trong `tenant_secrets`).

Rollback: chép lại `dist`, `static`, `package.json`, `.env` từ thư mục backup rồi reload; collection khôi phục từ `mongodump` của bước 5.

**Bản ghi deploy (24/10/2026):** bản `c2aa9cb` (đơn tenant) lên production lúc 23:31 qua `infra/deploy.sh`, từ một phiên làm việc khác (đi cùng commit `99b6b04` về privacy YouTube), trước khi Scribe, Localman, Tunelo kịp bỏ API nội bộ; Scribe chuyển bản mới cùng phút đó, Localman 23:33, Tunelo ngay sau. Sau deploy: `/claim`, `/admin`, `/.well-known/hoandat-enrollment` trả 404, discovery và `/jwks` 200 với cùng hai `kid`, không còn tiến trình nghe cổng 4501, log không có lỗi. 23:4x dọn server: bỏ 13 biến env của tính năng đã gỡ (`.env` cũ ở `/root/backup-261024-single-tenant/hoandat-auth.env.before-phase07`), reload, healthz ok; chuyển `00-tenants-http.conf` sang `/root/nginx-bak-261024/` (`nginx -T` không còn `$tenant_`), gỡ bốn unit `hoandat-tenant-*` (file unit cất trong thư mục backup), xoá `/usr/local/lib/hoandat-tenant-provisioner`, `/var/lib/hoandat-tenant-acme`, `/etc/letsencrypt-tenants`, `/var/www/hoandat-auth/deploy`; `shred` `/etc/hoandat-tenant-provisioner/`, `secrets/provisioner.pub.pem`, `secrets/scribe-sealing.pub.pem`. MongoDB: `mongodump` (`db/auth-before-drop.archive.gz`) rồi drop `tenants` (2 document), `tenant_claims` (0), `tenant_secrets` (0, đã purge trước đó). Bản sao `.env` trên iCloud cập nhật, khoá provisioner trên iCloud đã xoá. Quay lại: chép `dist`, `static`, `package.json`, `.env` từ thư mục backup rồi reload; collection khôi phục bằng `mongorestore` từ dump trên.

## Xoá tài khoản dừng giữa chừng

Xoá tài khoản (ADR 0009) khoá tài khoản trước (`disabledAt`) rồi mới xoá dữ liệu. Nếu một lượt xoá lỗi giữa chừng, tài khoản còn ở trạng thái khoá và không đăng nhập được. Sau khi backup (`infra/backup-auth-db.sh`), trong `/var/www/hoandat-auth`: `node --env-file=.env dist/finish-account-deletion.mjs <accountId>` (chỉ xem), rồi thêm `--confirm` để xoá phần còn lại. Script không gọi lại Apple hay back-channel logout.

## Client của app chat

App chat (repo `chat-next`, `https://chat.hoandat.com`, pm2 `chat-api` trên cùng máy) đăng nhập qua hai client `chat-web`, `chat-mobile` (`src/oidc/chat-clients.ts`). Không có client desktop: desktop dùng Chat web dạng PWA; `chat-desktop` đã gỡ ngày 20/10/2026. Deploy và vận hành phía chat ở `chat-next/docs/deployment-guide.md`; bước đầu của nó là đặt `.env` của IdP:

| Env | Ý nghĩa |
|---|---|
| `CHAT_WEB_URL` | origin của web chat, production `https://chat.hoandat.com`; redirect và back-channel logout của `chat-web` nằm dưới nó |
| `CHAT_WEB_CLIENT_SECRET` | ≥ 32 ký tự, **bắt buộc** (thiếu thì IdP không khởi động); sinh trên server, cùng giá trị ghi vào `/opt/chat/.env` dưới tên `OIDC_CLIENT_SECRET`. Hai bên lệch nhau thì chat nhận `invalid_client` ở `/token` |
| `CHAT_MOBILE_REDIRECT_URI` | tuỳ chọn, mặc định `com.hoandat.chat:/auth/callback`; đổi khi app chat đổi `urlScheme` trong `brand.config.json` |

Kiểm từ ngoài: IdP biết client thì chuyển lỗi "PKCE required" về đúng redirect của nó, client lạ thì không chuyển hướng:

```bash
for c in chat-web chat-mobile chat-desktop; do  # chat-desktop đã gỡ: phải in redirect rỗng
  curl -s -o /dev/null -w "$c %{redirect_url}\n" "https://auth.hoandat.com/auth?client_id=$c&response_type=code&scope=openid" | cut -d'?' -f1
done
```

**Trạng thái production (15/10/2026):** đã đặt `CHAT_WEB_URL`, `CHAT_WEB_CLIENT_SECRET` (chưa đặt `CHAT_MOBILE_REDIRECT_URI`, dùng mặc định); `/opt/chat/.env` có `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`; cả ba client có trên IdP (build 14/10/2026 15:57). 19/10/2026: deploy `84c169d` (`/account` liệt kê từng máy `chat-mobile`, `chat-desktop`), backup trước đó `auth-20261019-143353`. 20/10/2026: gỡ client `chat-desktop` trong code (desktop = PWA). 17:46 cùng ngày: deploy `0801e08` (gỡ `chat-desktop`, tên sản phẩm từ `brand.config.json`, `<meta name="description">`), backup trước đó `auth-20261020-174548` và `/root/hoandat-auth-backup-20261020-174549`; `chat-desktop` giờ trả 400 `invalid_client`, các client khác vẫn tới trang đăng nhập "Auth Next", discovery và JWKS không đổi. Rollback: deploy lại `34c70a1`.

## Client của app Scribe

App Scribe (repo `scribe-next`, thư mục local `one-scribe`, `https://scribe.hoandat.com`, systemd trên cùng máy) đăng nhập qua `scribe-web` (confidential, BFF: backend đổi code, cookie phiên của Scribe), `scribe-mobile` (public native, scheme riêng) và `scribe-web-dev` (tuỳ chọn, chỉ cho dev local) — `src/oidc/scribe-clients.ts`. Các client này đến từ env bên dưới.

| Env | Ý nghĩa |
|---|---|
| `SCRIBE_WEB_URL` | origin của Scribe, mặc định `https://scribe.hoandat.com`; redirect `/api/auth/callback`, back-channel `/api/auth/backchannel-logout` |
| `SCRIBE_WEB_CLIENT_SECRET` | tuỳ chọn, ≥ 32 ký tự; có thì bật `scribe-web` + `scribe-mobile` và thẻ Scribe ở `/apps`; thiếu thì không có client web và IdP vẫn khởi động. Cùng giá trị ở tệp secret OIDC của Scribe |
| `SCRIBE_MOBILE_REDIRECT_URI` | tuỳ chọn, mặc định `com.hoandat.scribe:/auth/callback`; phải trùng URL scheme của app iPhone |
| `SCRIBE_WEB_DEV_URL` + `SCRIBE_WEB_DEV_CLIENT_SECRET` | đặt cả hai hoặc không: bật `scribe-web-dev` (redirect loopback, cổng khớp chính xác, vd `http://localhost:5174/api/auth/callback`, không back-channel) và `scribe-mobile`, để thử dev local + iOS simulator trước khi site prod có |

Kiểm từ ngoài (cùng cách như chat): `for c in scribe-web scribe-mobile scribe-web-dev; do curl -s -o /dev/null -w "$c %{redirect_url}\n" "https://auth.hoandat.com/auth?client_id=$c&response_type=code&scope=openid" | cut -d'?' -f1; done`.

**Trạng thái production (16/10/2026):** deploy commit `e1a7c96`; `.env` có `SCRIBE_WEB_DEV_URL=http://localhost:5174` + `SCRIBE_WEB_DEV_CLIENT_SECRET` (bản sao ở máy dev của chủ sở hữu, `~/.onescribe-dev/.oidc-web-dev-secret`) ⟹ `scribe-web-dev`, `scribe-mobile` đang bật; `SCRIBE_WEB_CLIENT_SECRET` chưa đặt (bật khi `scribe.hoandat.com` có site, Phase 7b của plan Scribe).

## Client của Miu World

Miu World (repo `miu-world-next`, `https://miu.hoandat.com`, game cho mọi lứa tuổi, phụ huynh đăng nhập) dùng `miu-web` (confidential, BFF: server Miu đổi code rồi cấp phiên riêng của Miu), `miu-mobile` (public native cho app iPhone/Android, scheme `com.hoandat.miu`) và `miu-web-dev` (tuỳ chọn, chỉ cho dev local) — `src/oidc/miu-clients.ts`. Scope chỉ `openid email`, chỉ grant `authorization_code`: không có refresh token, Miu không giữ token nào của IdP sau khi đăng nhập.

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

## Client của Tiểu Đệ

Tiểu Đệ (repo `tieu-de-next`, `https://tieude.hoandat.com`) dùng `tieude-web` (confidential, `client_secret_basic`, scope chỉ `openid`, chỉ để biết `sub`; không refresh token) — `src/oidc/tieude-client.ts`. Redirect `/auth/callback`. Bật khi đặt **cả hai** `TIEUDE_WEB_URL` + `TIEUDE_WEB_CLIENT_SECRET` (≥ 32 ký tự); cùng secret nằm ở `AUTH_CLIENT_SECRET` trong `/var/www/tieude/.env`.

**Trạng thái production (26/10/2026):** đã bật, deploy commit `7e8a14d`. Kiểm từ ngoài: `curl -s -o /dev/null -w '%{http_code}\n' "https://tieude.hoandat.com/auth/login?lang=vi&cid=probe1234567890abcdef"` → 302 sang `auth.hoandat.com/auth`, và authorize của `tieude-web` trả 303 (như `chat-web`). Gặp `invalid_client` dù `seed-clients` liệt kê client ⟹ bản `dist` trên server cũ: `grep -c tieude-web /var/www/hoandat-auth/dist/server.mjs` phải ≥ 1, không thì chạy lại `infra/deploy.sh` (lần đầu đã gặp đúng chuyện này).

Rollback: xoá hai dòng `TIEUDE_WEB_*` rồi reload; nút đăng nhập ở Tiểu Đệ trả `login=fail`, phần còn lại của Tiểu Đệ chạy bình thường.

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

Collection `client_usage` (có `tenantId`, TTL 400 ngày trên `at`) tự tạo chỉ mục khi khởi động, hoặc trước đó bằng `dist/create-indexes.mjs`. Cập nhật `/privacy` đi cùng bản này. Đọc số liệu trong `/var/www/hoandat-auth`: `node --env-file=.env dist/growth-report.mjs` (8 tuần và 28 ngày gần nhất, theo `tenantId`: chỉ còn `primary`), thêm `--weeks N` (tối đa 57), `--tenant <id>`, `--json`. Script chỉ đọc. Có sự cố thì đặt `CLIENT_USAGE_ENABLED=false` trong `.env` rồi `pm2 startOrReload infra/ecosystem.config.cjs --update-env`; dữ liệu đã ghi tự hết theo TTL.

## Đăng nhập cho người duyệt ứng dụng (ADR 0010)

Tắt mặc định; chỉ bật trong thời gian App Store duyệt app (tài khoản demo theo Guideline 2.1).

**Bật**

1. Sinh hash trên máy chủ sở hữu, mật khẩu đi qua stdin (không bao giờ là tham số) và hash đi thẳng vào file trên server, không lưu tạm:

   ```bash
   printf '%s' "$REVIEW_PASSWORD" | pnpm -s review-login:hash \
     | ssh -p 24700 <user>@<SERVER_65_IP> 'umask 077; cat > /var/www/hoandat-auth/secrets/review-login.hash'
   ssh -p 24700 <user>@<SERVER_65_IP> 'chmod 600 /var/www/hoandat-auth/secrets/review-login.hash && ls -l /var/www/hoandat-auth/secrets/review-login.hash'
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

Ngoài server, mọi secret của IdP (Google/GitHub client, bot Telegram, admin MongoDB, bản sao `.env`) nằm ở thư mục iCloud `ENV production/auth-hoandat/secrets.json` của chủ sở hữu, không bao giờ vào repo. Từ 13/10/2026 (theo yêu cầu của chủ sở hữu) thư mục `ENV production/auth-hoandat/server/` giữ bản sao nguyên văn các tệp trên server, mode 600: `hoandat-auth.env`, `signing-keys.json` (khoá ký riêng). Khoá provisioner, khoá niêm phong Scribe và token Cloudflare của tenant không còn ở đó: huỷ khi gỡ đa tenant (ADR 0013); `.env` của Localman và Tunelo ở `ENV production/localman/server/`, `ENV production/tunelo/server/`. Chép lại sau mỗi lần đổi khoá hay `.env` (chép qua `ssh cat` vào tệp 600, so sha256 hai đầu, không in nội dung).

## Rollback

`pm2 stop hoandat-auth` và xoá file nginx của site (rồi `nginx -t` và reload). Database `auth` độc lập với các app khác; khôi phục từ backup: `mongorestore --gzip --archive=backups/auth-<stamp>.archive.gz --nsInclude='auth.*' --drop` với URI của user `auth`.
