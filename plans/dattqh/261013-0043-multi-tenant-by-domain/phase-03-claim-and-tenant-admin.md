---
phase: 3
title: "Nhận domain và trang quản trị tenant"
status: done
priority: P1
effort: "L"
dependencies: [2]
---

# Phase 03: Nhận domain và trang quản trị tenant

> Chế độ deep: scout lại `src/interactions/*`, `src/account-portal/*` và luồng upstream trước khi làm.

## Goal

Chủ domain bắt đầu nhận domain qua HTTPS trên `auth.hoandat.com/claim` sau khi đăng nhập bằng Google/GitHub; giá trị TXT gắn với lượt nhận và danh tính đó; owner đúng là danh tính đó; sau khi nhận, chủ domain cấu hình tenant trên `https://auth.<domain>/admin` và mọi thứ chạy trên domain của họ (RT 5, user chọn 2026-10-13).

## Phạm vi

- **Khởi tạo (RT 5):** `https://auth.hoandat.com/claim` (người nhận đăng nhập trước). Nhập domain → `normalizeTenantDomain` (RT 12) → từ chối public suffix, danh sách domain cấm (`hoandat.com` và mọi domain đang phục vụ trên .65, `inetdev.io.vn`), domain nằm trên/dưới tenant khác. Sinh claim id; giá trị TXT `_auth-claim.<domain>` = HMAC(claim id, danh tính người nhận); hết hạn 24 giờ; trần số lượt nhận đang chờ theo danh tính (RT 13).
- **Kiểm:** TXT đúng **và** A record của `auth.`, `localman.`, `tunnel.`, `*.localman.`, `*.tunnel.` trỏ thẳng IP .65 (không phải IP Cloudflare, vì wildcard hai cấp phải DNS-only, RT 11). Đạt thì tenant `claimed`, owner = danh tính người nhận, gửi yêu cầu chứng chỉ cho provisioner.
- **Cấu hình trên domain của tenant:** khi `auth.<domain>` có HTTPS, owner vào `/admin` bằng liên kết một lần gắn danh tính của họ (đăng nhập lại ở tenant bằng OAuth họ vừa khai, hoặc phiên chuyển tiếp ký từ `auth.hoandat.com` dùng một lần, chốt khi làm). Không có "người đến trước làm owner".
- **Trang quản trị (owner, CSRF + đăng nhập gần đây như `/account`):** tên hiển thị, OAuth Google/GitHub (hiển thị callback cần đăng ký), token DNS Cloudflare (kiểm quyền `Zone:DNS:Edit` trên đúng zone, niêm phong cho provisioner), Telegram tuỳ chọn. Không xem/xoay secret client app (RT 7).
- **Kích hoạt:** tenant `active` khi có owner **và** ít nhất một provider đăng nhập; trước đó không có form đăng nhập nào trên domain.
- Audit `tenant.claimed`, `tenant.configured`, `tenant.suspended` vào outbox của tenant.
- Từ chối nhận khi vượt `TENANT_MAX_ACTIVE` hoặc RAM trống dưới ngưỡng (acceptance 8); lượt `claimed` chưa `active` hết hạn và không tính vào trần active.
- i18n 3 ngôn ngữ; không mã màu ngoài `tokens.css`.

## Verification

- Test: TXT sai/thiếu/hết hạn, TXT của người khác, A record trỏ Cloudflare, domain cấm, public suffix → không tạo tenant; non-owner không vào `/admin`; người đăng nhập đầu tiên không phải người nhận thì không thành owner; secret không xuất hiện trong HTML, log, audit.
- Playwright: luồng nhận domain với DNS resolver giả.

## Risks

- Đây là thay đổi so với hợp đồng ban đầu ("trang nhận domain trên domain của họ"): chỉ bước khởi tạo đi qua `auth.hoandat.com`, đã được user chấp nhận.

## Kết quả (2026-10-13)

- Commit `0ca1f5d`. Vào `/admin` bằng liên kết một lần (2 phút) phát từ `/claim` khi owner vừa đăng nhập gần đây, mở phiên quản trị 30 phút (chốt câu hỏi mở: lần đầu tenant chưa có OAuth nên phương án "đăng nhập lại bằng OAuth vừa khai" không dùng được).
- Lượt nhận ở collection riêng `tenant_claims` (domain không unique, TTL 24 giờ): không ai giữ chỗ được domain của người khác.
- Trần đếm tenant `claimed` + `active`; `claimed` quá 7 ngày không kích hoạt thì hết hạn và giải phóng domain sau khi gỡ chứng chỉ (lệch nhẹ so với câu "không tính vào trần": được tính nhưng có hạn).
- Báo owner khi đình chỉ: trạng thái ở `/claim` và audit `tenant.suspended` (không có kênh gửi tin riêng).
- Test: `tenant-claim-service`, `tenant-claim-flow` (HTTP đầu-cuối với DNS, Cloudflare, Telegram giả), e2e `domain-claim.spec.ts`.
