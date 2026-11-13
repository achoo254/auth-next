---
status: done
tier: XL
created: 2026-11-13
---

# Xoá tài khoản chỉ ở auth.hoandat.com/account

## Mục tiêu
Mọi việc xoá tài khoản đi qua một chỗ: `auth.hoandat.com/account`. App không còn nút, màn hay API xoá riêng; khi auth xoá tài khoản, mọi app tự dọn dữ liệu của tài khoản đó.

## Hiện trạng (rà 13/11)
- Có luồng xoá riêng (UI + API): chat-next (xoá tài khoản chat, giữ 30 ngày, bắt chuyển chủ nhóm/kênh trước, "tự xoá nếu không dùng"), localman-next (module `account-deletion`, chặn khi còn workspace dùng chung), kb-next (`POST /api/me/delete-data`), miu-world-next (khu phụ huynh), scribe-next (`POST /api/me/delete`).
- shared-next `app-shell` footer có link "Delete account".
- auth xoá ngay (ADR 0009) và ghi `account.deleted` vào audit, nhưng không app nào nhận: dữ liệu ở app nằm lại.

## Ràng buộc
- Không đổi hợp đồng đăng nhập; giữ "Xuất dữ liệu" của Chat (không phải xoá).
- Tái dùng logic dọn dữ liệu sẵn có của từng app, chỉ đổi thứ kích hoạt nó.
- App Store đang dừng (Apple 5.1.1(v) cho phép link sang web xoá).

## Phase 1: auth báo xoá cho mọi app (M, auth-next)
- `account.deleted` gửi tới từng app đã khai (env danh sách URL), dạng SET ký như audit (ADR 0003), qua outbox có thử lại.
- Trang xác nhận xoá ở auth nói rõ dữ liệu trong mọi app bị xoá theo.

## Phase 2: mỗi app nhận và dọn (L, 13 repo)
- Endpoint server-to-server nhận SET, kiểm JWKS, gọi service dọn sẵn có (chat, localman, kb, miu, scribe) hoặc viết mới cho app chưa có.
- Chính sách khi có ràng buộc (nhóm/workspace dùng chung): theo quyết định bên dưới.

## Phase 3: gỡ luồng xoá riêng (M, 6 repo)
- Gỡ UI, API, i18n xoá ở chat, localman, kb, miu, scribe; thay bằng một dòng "Xoá tài khoản ở auth.hoandat.com/account".
- Chat: gỡ "Tự xoá nếu không dùng" và màn "đang chờ xoá".
- app-shell footer: link "Delete account" trỏ `auth.hoandat.com/account#account-delete`.

## Quyết định
1. Tài sản dùng chung: tự chuyển chủ (chủ sở hữu, 13/11).
2. Thời gian giữ: xoá ngay mọi nơi, bỏ 30 ngày của Chat (chủ sở hữu, 13/11).
3. Site Web Nhanh đang bị quản trị gỡ: xoá ngay như mọi thứ khác, báo cáo và nhật ký còn dạng chữ (Jev 0,93, `reports/jev-261113-webnhanh-takedown-*.json`).
4. Phiên đăng nhập cũng chỉ quản lý ở auth: Chat gỡ trang "Phiên đăng nhập" (chủ sở hữu, 13/11).

## Tiêu chí xong
- Không app nào còn nút/API xoá tài khoản; mọi chỗ trỏ về `auth.hoandat.com/account`.
- Xoá một tài khoản thử ở auth: mọi app nhận sự kiện và không còn dữ liệu của `sub` đó (trừ phần đã chọn giữ ở quyết định 1).

## Kết quả (13/11)
- 11 app nhận `account.deleted` trên prod: chat, localman (`/internal/account-deleted`), kb, miu, scribe, clip, lockin, tieude, truyen, tuvi, webnhanh; khai trong `ACCOUNT_DELETED_URLS` của IdP (bản cũ `/root/hoandat-auth.env.bak-20261113b`, iCloud đã chép).
- Thử hợp đồng trên prod: 11 bản giao cho một `sub` không tồn tại, cả 11 được nhận (2xx) trong 25 giây, nghĩa là chữ ký, `aud`, `iss` đúng ở mọi app.
- Chưa thử xoá một tài khoản thật có dữ liệu (cần một tài khoản Google/GitHub thử của chủ sở hữu).
- Chat migration dùng số `0038`: việc dọn `machine_install_codes` của plan Tunelo 3.0 phải đổi sang `0039`.

