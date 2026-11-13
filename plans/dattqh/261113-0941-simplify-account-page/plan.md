---
status: in-progress
adr: docs/decisions/0017-account-notices-in-chat.md
tier: M
created: 2026-11-13
---

# Tinh gọn trang /account

## Mục tiêu
Trang `/account` bớt thẻ, bớt dòng và bớt thao tác dọn dẹp mà không gỡ chốt chặn bảo mật thật.

## Ràng buộc
- Không đổi hợp đồng với client (token, grant, discovery, refresh).
- Giữ trang duyệt máy (device flow), trang hỏi quyền app bên ngoài, khoá provider cuối cùng.
- Trang vẫn không JavaScript (CSP); gọn bằng `<details>` thuần.

## Ngoài phạm vi
App iOS "Tài khoản" (đang dừng), `/api/account`.

## Phase 1: Server tự dọn grant trùng (S) — xong
- `completeConsent`: khi một grant theo thiết bị được duyệt, thu hồi các grant cũ cùng tài khoản, cùng client, cùng tên máy (bỏ qua khi không có tên máy).
- Ghi audit `grant.revoked` với cause mới `replaced`, sau khi thu hồi.
- File: `src/account-portal/device-grants.ts`, `src/interactions/consent-handler.ts`, `src/audit/audit-events.ts`.
- Test: máy đăng nhập lại hai lần chỉ còn một grant; khác tên máy hoặc khác client giữ nguyên.

## Phase 2: Gom giao diện (M) — xong
- Ba nhóm thành hai: "Tài khoản" (hồ sơ, cách đăng nhập, Telegram) và "Nơi đang đăng nhập" (trình duyệt + máy/app trong một thẻ). Thẻ "App bên ngoài" luôn hiện (trống thì ghi trống) vì menu tài khoản của Localman link tới `#account-apps`.
- Thẻ app chỉ liệt kê client không tĩnh; app nhà biến khỏi danh sách (đăng xuất đã phủ tác dụng gỡ quyền).
- Tên máy là User-Agent thì hiện dạng "Safari trên iOS".
- Năm dòng mới nhất hiện sẵn, phần còn lại trong `<details>`. Nút từng dòng dạng nhẹ; "Đăng xuất mọi trình duyệt khác" là nút chính.
- Ô số liệu đầu trang: cách đăng nhập, nơi đang đăng nhập, app bên ngoài (khi có).
- i18n vi/en/zh-cn, snapshot, e2e liên quan.

## Phase 3: Thông báo qua app Chat (L, auth-next + chat-next) — đã lên prod 13/11, chờ chủ sở hữu bật thử
Thiết kế chốt 13/11 (chủ sở hữu chọn "gửi theo mã tài khoản"): xem `docs/decisions/0017-account-notices-in-chat.md`. Không mã liên kết, không token bot, không webhook.
- auth-next: env `CHAT_NOTICES_URL`; trường `chatNotices` trên tài khoản (bật/tắt qua `AccountLinks`, `$inc securityVersion`, audit `method: "chat"`); thẻ Telegram thành "Thông báo bảo mật" có thêm công tắc Chat; `notifyAccount` gửi bản dịch của push tới Chat bằng token tự ký.
- Prod: auth-next `e904753`, chat-next `6599624`; nginx của Chat cài bằng root (bản cũ ở `/root/chat.hoandat.com.conf.bak-20261113`); `.env` IdP thêm `CHAT_NOTICES_URL` (bản cũ `/root/hoandat-auth.env.bak-20261113`, iCloud đã chép).
- chat-next: `POST /api/account-notices` kiểm token IdP (`VerifyAccessToken`, `client_id` + `scope`), tìm người dùng theo `idp_sub`, gửi qua bot trợ lý (như `NotifyModeration`); không có người dùng thì vẫn `204`.

## Tiêu chí xong
- `pnpm lint && pnpm typecheck && pnpm check:tokens` sạch ở local, test liên quan chạy từng file; CI xanh.
- Trang `/account` không còn thẻ "Thiết bị", "Phiên đang mở" riêng, không liệt kê app nhà.
- Bật "Gửi qua Chat" trên tài khoản thật: một thay đổi bảo mật gửi tin từ bot trợ lý trong Chat; tắt thì ngừng gửi.
