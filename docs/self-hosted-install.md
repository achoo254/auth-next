# Cài tenant tự host

Hướng dẫn cho chủ một domain đã chọn **tự host** ở `/claim` (ADR [0007](decisions/0007-self-hosted-tenants.md)): đăng nhập, Localman, Tunelo và Chat chạy trên máy của họ, với domain của họ là tenant chính. Gateway (`https://auth.hoandat.com`) chỉ xác minh domain và cấp gói enrollment; cài xong, không request hay dữ liệu nào đi qua gateway.

Bundle nằm ở `deploy/self-hosted/` của repo này và build image từ mã nguồn của ba repo: hoandat-auth, localman-next, chat-next.

> **Trạng thái (17/10/2026):** đã build và chạy trọn trên box LAB 183 (Docker 29.7, 2 nhân, 4 GB RAM) với chứng chỉ tự ký: cả bốn app lên, đăng nhập đi tới Google, audit tới Localman qua loopback, không dòng lỗi nào trong log. Chưa chạy ở nơi có IP công khai: chứng chỉ Let's Encrypt thật, đổi gói với gateway thật, đăng nhập Google/GitHub trọn vẹn và Turnstile thật còn chờ một VM công khai và domain thử (`plans/dattqh/261017-0735-self-hosted-tenant/`).

## Trách nhiệm

hoandat không backup, không cập nhật, không vá bảo mật và không giám sát bản cài này. Dữ liệu nằm trong các volume Docker của máy (`mongo-data`, `postgres-data`, `certificates`) và trong `deploy/self-hosted/data/` (mọi secret). Mất `data/secrets/` là mất khoá ký, khoá phiên và khoá mã hoá biến của Localman: backup nó cùng các volume.

## Cần chuẩn bị

- Một máy Linux có Docker Engine và Docker Compose v2.17 trở lên (dùng `additional_contexts` dạng `service:`), IPv4 công khai, cổng 80, 443 và dải cổng TCP của Tunelo mở. Build cả bốn app cần khoảng 4 GB RAM trống.
- Domain đã nhận ở `/claim` chế độ tự host (tenant ở trạng thái "chờ bản cài"), và gói enrollment tải từ nút **Tải gói cài đặt** (hạn 24 giờ; hết hạn thì tải gói mới).
- Zone DNS của domain ở Cloudflare và một API token có quyền sửa DNS zone đó: chứng chỉ wildcard của `*.localman.` và `*.tunnel.` cần DNS-01.
- Bản ghi A (DNS only) trỏ về IP của máy: `auth.`, `chat.`, `localman.`, `*.localman.`, `tunnel.`, `*.tunnel.`. Giữ bản ghi TXT `_auth-claim.<domain>`: gateway kiểm nó định kỳ để không ai nhận lại domain.
- Một widget Cloudflare Turnstile cho `localman.<domain>` (site key và secret key): Localman không khởi động ở production nếu thiếu, kể cả với key thử nghiệm của Cloudflare.
- OAuth app Google và/hoặc GitHub của chính chủ domain, callback `https://auth.<domain>/oauth/google/callback`, `https://auth.<domain>/oauth/github/callback`.
- Bản checkout sạch của localman-next và chat-next (một bản phát hành, không có sửa đổi cục bộ).

## Cài

```bash
cd deploy/self-hosted
cp .env.example .env && chmod 600 .env   # điền DOMAIN, ENROLLMENT_BUNDLE, token, OAuth...
./init.sh                                # sinh secret, env của từng app, build image, tạo khoá
docker compose up -d
```

`init.sh` chạy lại được bất cứ lúc nào sau khi sửa `.env`: secret đã sinh (`data/secrets/generated.env`) không bao giờ đổi. Nó không in secret nào.

Khi khởi động, IdP kiểm gói (đúng gateway, đúng domain), rồi đổi gói ở gateway; gateway gọi `https://auth.<domain>/.well-known/hoandat-enrollment` nên chứng chỉ và DNS phải sẵn sàng. IdP thử lại mỗi phút tới khi gateway kết luận; thành công thì ghi `data/secrets/auth/enrollment-key.json.enrolled` và từ đó không bao giờ gọi gateway nữa. Trên `/claim` của gateway, domain chuyển sang "Chạy trên máy chủ của bạn".

Kiểm:

```bash
docker compose ps
docker compose logs auth | grep -i enroll
curl -s https://auth.<domain>/.well-known/openid-configuration | head -c 200
```

## Bên trong bundle

| Thành phần | Nguồn | Ghi chú |
|---|---|---|
| `nginx` | `images/nginx.Dockerfile`, `nginx/assemble.sh` | Lắp từ chính các block tenant của ba repo (`infra/nginx/tenant-*.conf`, `localman-tenants.conf`, `tunelo nginx-tenants.conf`, block chat render bằng `render-tenants-nginx.sh`); chỉ bỏ listener IPv6, điền hash CSP của bản build Localman và cho `/internal/` của Localman nhận audit từ loopback (`nginx/localman-internal.inc`). Luật real-IP Cloudflare ở cấp http như máy chủ dùng chung (`nginx/selfhosted-http.conf`). |
| `auth`, `localman`, `tunelo`, `chat` | `Dockerfile` của repo này, `images/*.Dockerfile` | Dùng chung network namespace với `nginx` và nghe trên `127.0.0.1` như trên máy chủ dùng chung, nên chỉ tin địa chỉ chuyển tiếp từ loopback. Web của Localman và Chat build theo domain (`VITE_IDP_ORIGIN`, `brand.config.json`). |
| `chat-migrate` | image của chat | Chạy `-role migrate` trước `chat`. |
| `mongo`, `postgres` | `mongo:7` (replica set một node), `postgres:16-alpine` | Không mở cổng ra ngoài. |
| `certbot` | `certbot/dns-cloudflare`, `certbot/run.sh` | Một chứng chỉ cho mọi host, kể cả wildcard; nginx đọc theo SNI và tự reload 12 giờ một lần. |

Chưa có: media của Chat (`MEDIA_PUBLIC_URL` không đặt, tải tệp tắt), Telegram, Web Push. Cập nhật phiên bản là phase 04 (kênh phát hành có chữ ký).
