---
status: in-progress
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

## Phase 3: Nhận thông báo qua app Chat (L, liên repo auth-next + chat-next)
Ngoài Telegram, tài khoản nhận thông báo qua app Chat; kênh bật thì auth-next tự có bot bên Chat để gửi.
- Cùng chỗ với Telegram trong nhóm "Tài khoản": dòng "Thông báo qua Chat" với Bật/Tắt, chỉ hiện khi kênh được bật ở server.
- Bot tự tạo: khi kênh bật (env, mặc định tắt), auth-next khởi động thì đảm bảo có một bot hệ thống của nó bên Chat (tạo nếu chưa có, idempotent), không cần ai vào BotAdmin tạo tay. Chat thêm một đường server-to-server cho việc này, xác thực như `POST /api/tunelo-agent/grants/revoke` (client credentials), chỉ quản bot hệ thống của chính auth-next.
- Liên kết giống Telegram: mã một lần 10 phút → mở link bot trên Chat kèm mã → người dùng bấm Bắt đầu (luật consent chat riêng của Bot API) → webhook bot về auth-next xác nhận, lưu chat id theo tài khoản (đi qua `accountTokens`, `$inc securityVersion`, audit `method.linked`/`unlinked` kênh `chat`).
- Gửi: `notifyTelegram` thành gửi tới mọi kênh đang bật (Telegram, Chat), chạy nền, lỗi một kênh không chặn thao tác bảo mật; bot bị chặn (403) thì đánh dấu kênh chưa kích hoạt như Telegram.
- Không log mã liên kết, token bot, chat id cùng nội dung; collection mới (nếu có) vào `TENANT_COLLECTIONS` và `purgeAccountData`.
- Ngoài phạm vi phase này: đưa chat id kênh Chat cho Localman qua claim như `telegram_chat_id` (làm sau nếu cần).
- Câu hỏi mở: (1) bot token do Chat trả về mỗi lần "ensure" hay auth-next giữ trong secret mount sau lần tạo đầu; (2) cần ADR mới cho kênh liên lạc mới ở auth-next.

## Tiêu chí xong
- `pnpm lint && pnpm typecheck && pnpm check:tokens` sạch ở local, test liên quan chạy từng file; CI xanh.
- Trang `/account` không còn thẻ "Thiết bị", "Phiên đang mở" riêng, không liệt kê app nhà.
- Bật "Thông báo qua Chat" trên một tài khoản thật: bot của auth-next tự có bên Chat, bấm Bắt đầu xong thì một thay đổi bảo mật (liên kết provider) gửi tin tới cả Telegram và Chat; tắt thì ngừng gửi.
