---
phase: 3
title: "Bundle compose bốn app"
status: done
priority: P2
effort: "XL"
dependencies: [2]
---

# Phase 03: Bundle compose bốn app

## Goal

Một bundle docker compose dựng đủ IdP, Localman, Tunelo, Chat, MongoDB, Postgres, nginx và certbot trên một máy sạch của tenant, với domain của tenant là tenant chính, đổi gói enrollment lúc khởi động, và chạy đủ các luồng đăng nhập mà không request nào đi qua hoandat.

## Bối cảnh đã đo

- hoandat-auth đã có `Dockerfile` và `docker-compose.yml` cho máy dev (MongoDB 7 replica set một node, cổng chỉ bind `127.0.0.1`).
- localman-next có `docker-compose.yml` ở gốc repo; chat-next chưa có Dockerfile ở hai tầng thư mục đầu.
- Localman, Tunelo, Chat gọi API nội bộ loopback của IdP (`INTERNAL_HOST:INTERNAL_PORT`) với Basic credentials riêng từng app; trong compose thì "loopback" là mạng nội bộ của compose, không mở ra ngoài.
- Provisioner (`src/provisioner/`, `infra/provisioner/`) chạy certbot bằng `execFile`, dùng token DNS Cloudflare niêm phong; wildcard cần DNS-01.
- Production trên .65 vẫn chạy pm2, không đổi trong phase này.

## Files to Create / Modify

- Create `deploy/self-hosted/compose.yaml` (repo hoandat-auth hoặc repo đóng gói riêng, chốt ở bước 1): dịch vụ `auth`, `localman`, `tunelo`, `chat`, `mongo`, `postgres`, `nginx`, `certbot`/provisioner; mạng nội bộ; volume dữ liệu; chỉ nginx mở 80/443.
- Create `deploy/self-hosted/.env.example`: domain, URL gateway, đường dẫn gói enrollment, client id/secret Google/GitHub, token DNS Cloudflare, Telegram tuỳ chọn; secret sinh tự động lần đầu (khoá ký, `COOKIE_KEYS`, `TENANT_SECRETS_KEY`, Basic credentials nội bộ, secret client của app) bằng một lệnh `init`, không bao giờ in ra.
- Create `deploy/self-hosted/nginx/`: mẫu block cho `auth.`, `chat.`, `localman.`, `*.localman.`, `tunnel.`, `*.tunnel.` (dựa trên `infra/nginx/` hiện có).
- Modify `Dockerfile` (hoandat-auth): image production (build trong image, chạy user không phải root, chỉ đọc `secrets/`).
- Create Dockerfile cho Localman/Tunelo (localman-next) và Chat backend + web (chat-next), theo cùng nguyên tắc.
- Create `deploy/self-hosted/README.md` hoặc mục trong `docs/`: yêu cầu máy, các bước cài, sao lưu (tenant tự lo).

## Steps

1. Chốt nơi đặt bundle (đề xuất: thư mục `deploy/self-hosted/` trong hoandat-auth, image lấy từ registry của từng repo).
2. Image production cho từng app; chạy được với env của một tenant chính bất kỳ.
3. Compose: mạng, volume, healthcheck, thứ tự khởi động (Mongo replica set, Postgres, IdP, rồi các app).
4. Chứng chỉ: provisioner trong compose với token DNS của tenant; HTTP-01 không đủ cho wildcard.
5. Lệnh `init` sinh secret và kiểm env; lần khởi động đầu đổi gói enrollment (phase 02).
6. Thử trên một VM sạch với một domain thử nghiệm.

## Validation

- Trên VM sạch: đăng nhập Google/GitHub, Localman web và MCP, `tunelo login --server https://tunnel.<d>` và token exchange, Chat web, mobile, desktop.
- Bắt traffic ra của VM trong lúc chạy các luồng trên: không có request nào tới hoandat ngoài lượt đổi gói và kéo bản phát hành.
- `docker compose config` không chứa secret dạng rõ; log các container qua redaction như production.

## Risk / Rollback

- Rủi ro: bốn app khác phiên bản trong một bundle. Mỗi bản phát hành ghim phiên bản của cả bốn image (phase 04).
- Rủi ro: zone không ở Cloudflare thì không có wildcard. Ghi rõ là yêu cầu trong tài liệu cài đặt.
- Lùi: phase này không đụng production; bỏ thư mục bundle là đủ.

## Tiến độ (17/10/2026)

Đã viết, **chưa chạy trên máy thật** (máy dev không có Docker):

- `deploy/self-hosted/`: `compose.yaml`, `.env.example`, `init.sh`, `images/{localman,tunelo,chat,nginx}.Dockerfile` (kèm `.dockerignore` riêng), `nginx/{assemble.sh,selfhosted-http.conf,localman-internal.inc,reload-on-renewal.sh}`, `certbot/run.sh`. Hướng dẫn: `docs/self-hosted-install.md`. ADR 0007 §5 ghi các quyết định dưới.
- Làm khác plan: không sửa localman-next hay chat-next (Dockerfile nằm trong bundle, build từ checkout của hai repo); certbot `dns-cloudflare` thay provisioner; app dùng chung network namespace với nginx để giữ nguyên cấu hình nginx và mô hình loopback của production; không có API nội bộ (domain là tenant chính).
- Đã kiểm: cấu hình nginx lắp từ ba repo thật qua `nginx -t` (nginx 1.31 của Homebrew, bản sao đổi đường dẫn); chạy nginx thật với chứng chỉ tự ký: `/internal/` của Localman cho loopback (502 vì không có upstream), 403 khi có `CF-Connecting-IP` của visitor hoặc `X-Localman-Proxy`. Hai lỗi bắt được khi thử: thứ tự include làm `chat_hook` chưa khai báo; thiếu luật real-IP Cloudflare ở cấp http làm request Flexible tới Localman mang `127.0.0.1` (đã sửa, test `cloudflare-ips.test.ts` giữ danh sách).
- Sửa kèm phase 02: gói hết hạn làm IdP không khởi động lại được sau 24 giờ; giờ IdP ghi `<ENROLLMENT_KEY_PATH>.enrolled` khi đổi gói xong và các lần sau bỏ qua enrollment (test trong `tenant-enrollment.test.ts`).
- Shellcheck sạch trên bốn script.

Còn lại để đóng phase: build và chạy trên một VM sạch có Docker với một domain thử (Cloudflare), chạy đủ mục Validation ở trên. Rủi ro chưa kiểm: build `pnpm install` trong image (lockfile, native module trên Alpine), Localman/Chat chạy trong namespace chung, certbot cấp wildcard, Tunelo TCP qua cổng publish.

## Nghiệm thu trên LAB (17/10/2026, box 183, user cho phép dùng 183-185)

Mã nguồn: hoandat-auth `0ffd637` (bundle), localman-next `ab09998`, chat-next `4bd9ef2` (`git archive HEAD`, không lẫn sửa dở). Domain thử `selfhost-lab.example.org`, chứng chỉ tự ký đặt vào volume như `certbot/run.sh` để lại; nginx publish 8080/8443 vì nginx của box giữ 80/443; enrollment tắt cho LAB (IP riêng, gateway chỉ gọi địa chỉ công khai; Jev 0,99); Localman chạy `NODE_ENV=development` trong file compose phụ của LAB vì không có widget Turnstile thật.

Kết quả (`curl` qua nginx, chỉ in mã trạng thái và đích chuyển hướng):

- IdP: `/healthz`, JWKS, `/apps` 200; issuer `https://auth.selfhost-lab.example.org`; `/internal` 404; http chuyển https (301).
- Năm client (`chat-web`, `chat-mobile`, `chat-desktop`, `localman-web`, `tunelo-web`) được IdP nhận và chuyển lỗi PKCE về đúng redirect của chúng.
- Localman `/auth/login` → IdP → trang interaction có nút Google → `accounts.google.com` với `client_id` của bản cài, callback `https://auth.<d>/oauth/google/callback`, PKCE, state, nonce.
- Chat `/`, `/healthz` 200; `/auth/login` → IdP với PKCE; `/ws` 403 khi không có phiên (tới Chat, không phải 502).
- Tunelo `/login` → `/account` của IdP; `demo.tunnel.<d>` trả "Tunnel not found: demo" từ Tunelo; 20 cổng TCP publish.
- Audit: từ namespace của IdP tới `https://localman.<d>/internal/audit-events` trả 401 (tới được, thiếu xác thực); từ ngoài kèm `CF-Connecting-IP` trả 403.
- Không dòng lỗi nào trong log của nginx, auth, localman, tunelo, chat; stack dùng khoảng 480 MB RAM.

Lỗi bundle tìm ra và đã sửa (commit `0ffd637`): `brand:gen` của Chat cần trình duyệt (bỏ, đầu ra không phụ thuộc domain); `pnpm install` của Tunelo trong workspace; nginx image thiếu `localman-internal.inc`; certbot để khoá riêng mà worker nginx không đọc được; IdP production không nhận `TRUST_PROXY=loopback` (giờ `127.0.0.1`); Localman production bắt buộc Turnstile (biến mới, bắt buộc).

Đã dọn: stack và volume thử đã gỡ, swap tạm đã gỡ; còn lại trên 183 image `selfhosted-*` (2,4 GB), build cache (6,3 GB) và mã nguồn `/opt/selfhosted-test` (61 MB) để thử lại nhanh.

Còn lại để đóng phase (cần VM có IP công khai và domain thử trên Cloudflare): certbot cấp wildcard thật, đổi gói với gateway thật (cần bật `SELF_HOSTED_CLAIMS` trên production), đăng nhập Google/GitHub trọn vẹn, Turnstile thật.
