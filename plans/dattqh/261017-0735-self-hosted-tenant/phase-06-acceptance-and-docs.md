---
phase: 6
title: "Nghiệm thu đầu-cuối và tài liệu"
status: in-progress
priority: P2
effort: "M"
dependencies: [4, 5]
---

# Phase 06: Nghiệm thu đầu-cuối và tài liệu

## Goal

Chạy đủ sáu tiêu chí nghiệm thu của `plan.md` trên một tenant mới tự host và một tenant chuyển từ hoandat, rồi cập nhật tài liệu cho tenant và cho vận hành.

## Steps

1. Tenant mới: nhận domain ở chế độ tự host, cài bundle trên VM sạch, đổi gói, chạy các luồng của phase 03, bắt traffic ra.
2. Tenant chuyển: dùng một tenant thử (không phải tenant của khách) chuyển theo phase 05, kiểm số đếm, refresh token, `kid`; purge sau thời hạn (có thể rút ngắn cho tenant thử).
3. Bật `SELF_HOSTED_CLAIMS` trên production khi user yêu cầu tường minh.
4. Tài liệu:
   - `docs/tenant-owner-guide.md` và trang `/guide/domain` (`src/guide/`): chế độ tự host, yêu cầu máy, trách nhiệm của tenant; chụp lại ảnh bằng `pnpm guide:screenshots`.
   - `docs/deployment-guide.md`: quy trình chuyển tenant, purge, xử lý gói enrollment.
   - `CLAUDE.md`: thêm ADR 0007 vào danh sách quyết định; quy tắc mới (tenant `self_hosted` không bao giờ có runtime, chứng chỉ, block nginx trên hoandat; gói enrollment không chứa secret).
   - `docs/decisions/0007-self-hosted-tenants.md`: trạng thái "chấp nhận", ghi kết quả đo.

## Validation

- Đủ sáu tiêu chí nghiệm thu, có số đếm và lệnh đã chạy.
- Cổng đầy đủ của ba repo sạch.

## Risk / Rollback

- Bật cờ trên production mà bundle chưa ổn thì tenant kẹt ở `enrolling` và hết hạn sau 24 giờ; tắt cờ là đủ.

## Tiến độ (17/10/2026)

- Tài liệu: `/guide/domain` có mục "Chạy domain trên máy chủ của bạn" (ba ngôn ngữ, chỉ hiện khi `SELF_HOSTED_CLAIMS` bật; nhãn nút khớp `/claim`), `docs/tenant-owner-guide.md`, `CLAUDE.md` (ADR 0007, quy tắc tenant tự host), trạng thái ADR 0007. Sửa tài liệu phase 05: tenant `migrating` thôi phục vụ ngay khi bấm chuyển (`SERVING_STATUSES`), không phải tới lúc đổi DNS.
- Release 0.2.0 (localman-next `a5b9470`, chat-next `fa317f5`): sáu image qua `cosign verify`, danh tính sai bị từ chối; image có `export/import-tenant` và `migrate/`.
- LAB 183 cập nhật 0.1.0 → 0.2.0: lần đầu nginx đụng cổng 80 vì lượt cập nhật chạy `update.sh` của 0.1.0 (chưa nạp `compose.override.yaml`) và script thoát không lùi bản khi `up -d` lỗi. Sửa: `up -d` lỗi cũng lùi bản. Chạy lại: đủ service, kiểm phase 03 như cũ.
- Cổng hoandat-auth: lint, typecheck, tokens sạch; 577/577 test; e2e 11/11.

Còn lại (cần user): deploy IdP và Localman lên .65, bật `SELF_HOSTED_CLAIMS`, VM công khai và domain thử cho bước 1–2; ảnh chụp `pnpm guide:screenshots` khi có trang thật của chế độ tự host.

## Diễn tập chuyển inetdev.io.vn (19/10/2026)

User chọn diễn tập rồi huỷ (Jev 0,63; chờ VM công khai 0,32; chuyển hẳn qua Cloudflare Tunnel 0,05): box lab chỉ có IP nội bộ, chưa có công cụ chuyển ngược.

- Bản cài trên LAB 183 (2 vCPU, 3,9 GB, Docker 29.9 cài lại sau khi box được dọn): hoandat-auth `db36f50`, localman-next `a5b9470`, chat-next `b67371c`, build tại chỗ bằng `init.sh`, chứng chỉ tự ký, enrollment tắt (địa chỉ nội bộ).
- 09:22 bấm "Move to your own servers" (trình duyệt của owner); `auth.inetdev.io.vn` trả 421 ngay. Backup `auth-20261019-092301`, `localman-20261019-092301` và chat trên .65; `export-tenant.sh` 212 KB: IdP (1 tài khoản, 7 refresh token, 4 grant, 9 phiên), Localman (1 workspace, 1 project, 1 user, 18 audit), Tunelo (1 usage log), chat (2 user, 2 chat, 3 tin nhắn, 1 bot).
- Import lần đầu dừng ở bước kiểm: bản cài mới luôn có bot trợ lý của chat (`bots.is_system`), nên "chat đã có 1 user". Sửa `import-tenant.sh`: không đếm bot đó, xoá nó trước khi nạp chat; bot của tenant chuyển sang thay vào.
- Sau import: JWKS của bản cài đúng hai `kid` của inetdev trên prod (`8OxnRF…` ES256, `74mRHW…` RS256); issuer `https://auth.inetdev.io.vn`; trang đăng nhập có GitHub của tenant (OAuth app chuyển qua JWE); Localman nhận tenant `inetdev`; chat 2 user, 1 bot hệ thống, 3 tin nhắn, `server_epoch` 2; reseal chạy với `SESSION_KEY` cũ; log không có lỗi.
- 09:26 "Cancel the move", `pm2 start chat-api-inetdev`: auth, chat, localman 200, JWKS như cũ, tunnel 200 sau khoảng 10 giây (cache tenant của Tunelo). Số document của inetdev trên prod như trước, audit thêm 2 sự kiện. Ngừng khoảng 4–5 phút.
- Dọn: thư mục export trên .65, bản sao trên máy dev, toàn bộ bản cài, Docker và swap trên 183.

Chưa thử được (cần VM IP công khai và domain thử): bản cài đổi gói với gateway, đổi bản ghi A, refresh token của client thật dùng tiếp sau khi chuyển, chứng chỉ Let's Encrypt và Turnstile thật.

## Chuyển trọn hoandat.io.vn sang VM công khai (19/10/2026)

User chọn chạy trọn một lượt chuyển (Jev 0,38 / nhận mới tự host 0,62, user quyết). VM iNET Cloud Server dùng thử 1 vCPU, 1 GB, 20 GB, Ubuntu 22.04, SSH cổng 24700; cài bằng `init.sh --release 0.3.1` (không build, 1 phút 25 giây) + 2 GB swap. Domain `hoandat.io.vn` (Cloudflare; prod bỏ khỏi `CLAIM_BLOCKED_DOMAINS` và `PROVISIONER_BLOCKED_DOMAINS`, backup `*.bak-261019-094947`).

- Nhận domain chạy trên hoandat: xác minh DNS chập chờn ~1,5 giờ vì zone cũ còn trên ns1–ns3.inet.vn (trả NXDOMAIN có `aa`) và Google DNS nhớ delegation cũ (TTL 12 giờ); hết khi nhập cùng bản ghi vào DNS iNET. GitHub OAuth App riêng; tenant `active`, chứng chỉ provisioner cấp 11:23.
- Dữ liệu thử: Tunelo CLI đăng nhập bằng device flow (tài khoản đầu tiên, refresh token giữ trong HOME riêng), Localman 1 workspace/1 project/10 record. Tenant không có Chat trên .65.
- Trước khi bấm chuyển: chứng chỉ Let's Encrypt thật trên VM qua DNS-01 (hạn 2027-01-17), Mongo/Postgres/schema chat sẵn.
- 11:40 bấm chuyển và tải gói; backup `auth-20261019-114119`, `localman-20261019-114119`, chat; export 192 KB; import trên VM; 11:42 đổi bản ghi A (Cloudflare + DNS iNET); 11:43:47 bản cài đổi gói, gateway ghi `self_hosted`. Ngừng khoảng 4 phút.
- Sau chuyển: access token cũ hết hạn 11:47, Tunelo CLI refresh bằng refresh token cấp trên .65 với IdP trên VM (token mới hạn 12:02), tunnel `*.tunnel.hoandat.io.vn` mở qua Tunelo trên VM và trả đúng nội dung. VM dùng 548 MB RAM + 305 MB swap.
- Lỗi lộ ra và đã sửa: `update.sh` không khởi động certbot (0.3.1); export dừng khi tenant không có Chat; import cần nginx đã chạy để chạy container auth/localman (bản cài mới chưa từng khởi động nginx) — lần đầu import đã nạp IdP rồi dừng, xoá database `auth` của bản cài (chỉ có 15 document vừa nạp) rồi chạy lại.

Còn lại: purge `hoandat.io.vn` trên .65 sau 14 ngày (`migrate/purge-tenant.sh`); phát hành bản có hai bản sửa sau cùng; chữ "Not active yet" ở thẻ Google của /admin khi tenant đã active nhờ GitHub.
