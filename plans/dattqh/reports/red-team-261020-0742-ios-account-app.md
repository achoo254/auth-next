# Red team: plan app iOS Tài khoản (20/10/2026)

Ba reviewer đã soi bản đầu của plan `261020-0742-ios-account-app`, mỗi người một góc: bảo mật, lỗi khi chạy, giả định. Các phát hiện trùng nhau được gộp lại. Phát hiện nào cũng có dẫn chứng `file:line` trong code nên không bị loại vì thiếu bằng chứng. Tất cả đều được chấp nhận và đã đưa vào plan.

| # | Mức | Phát hiện | Cách xử lý trong plan |
|---|---|---|---|
| 1 | Critical | `link-ticket` chỉ cần bearer. Kẻ lấy được access token có thể liên kết Google của mình vào tài khoản nạn nhân. Thêm nữa, `finishAccountLink` đòi phiên IdP trong cookie (`upstream-account-link.ts:38-42`), nên luồng này không chạy trong phiên ephemeral | Phase 02: link cần đăng nhập lại; purpose `link-app` với state gắn tài khoản, `securityVersion` và grant, dùng một lần; không tạo `oidc_session`; ghi vào ADR 0009 |
| 2 | Critical | Sign in with Apple chưa bật ở production (`docs/deployment-guide.md:163`), mà 4.8 và ghi chú review đều dựa vào nó | Thêm phase 00 làm điều kiện cứng trước phase 04 |
| 3 | High | API bỏ yêu cầu đăng nhập gần đây ở thao tác gỡ quyền ứng dụng và đăng xuất các phiên khác (`account-confirm-routes.ts:72-74,122-125`) | Phase 02: bảng guard web ↔ API; `revoke-others` của app đổi thành `revoke-all` |
| 4 | High | Xoá tài khoản không có hàng rào, nên login, refresh hay link chạy song song vẫn để lại dữ liệu | Phase 01: bước 0 đặt `disabledAt` + `$inc securityVersion`, đọc lại, quét theo `accountId`, xoá `accounts` sau cùng, cho phép chạy lại |
| 5 | High | Danh sách dữ liệu cần xoá thiếu `oidc_interaction`, grant đã hết hạn, claim, IP/UA trong outbox; viết sai chữ ký `revokeFor` | Phase 01: liệt kê đủ; thêm `revokeAllFor`; xoá trắng context outbox; ADR ghi đúng những gì còn giữ |
| 6 | High | Xoá tài khoản bỏ qua back-channel logout, nên RP vẫn giữ phiên | Phase 01: gọi `revokeSession` và `revokeGrants` |
| 7 | High | Đăng nhập lại với client gắn thiết bị tạo grant mới mỗi lần; `auth_time` không có trong ID token | Phase 02/04: `require_auth_time`; app chuyển sang grant mới rồi thu hồi grant cũ; test đếm grant |
| 8 | High | Payload đẩy dùng chung khoá Telegram nên có `{email}` | Phase 03: `PushKind` có kiểu, bộ khoá `push.*`, chỉ cho tham số an toàn |
| 9 | High | `push_devices` sống lâu hơn grant (khi revoke ở `/token/revocation`, khi phát hiện refresh token bị dùng lại, khi TTL xoá) | Phase 03: kiểm `Grant.find` trước khi gửi; listener `grant.revoked`; `expiresAt` trượt; app gọi DELETE trước khi đăng xuất; tự mở lại kết nối HTTP/2 |
| 10 | High | AASA và entitlements thiếu `webcredentials` | Phase 02/04: khai cả hai; lùi về scheme riêng chỉ khi user đồng ý; trang callback `no-store` và `no-referrer` |
| 11 | Medium | Chặn owner tenant sổ theo khoá không tồn tại, và mâu thuẫn với phạm vi | Bỏ việc chặn; chỉ xoá ở tenant chính; trang xác nhận cảnh báo quyền owner vẫn còn |
| 12 | Medium | `allowed_resources: []` cần `CLIENTS_WITHOUT_RESOURCES`; `clients.ts` đã đủ 200 dòng | Phase 02: `account-ios-client.ts` tự export các tập; tách `security.ts` nếu cần sửa |
| 13 | Medium | Rate limit "theo `sub`, cơ chế đang có" không tồn tại; path có tham số không khớp | Phase 02: limiter mới theo IP và theo tài khoản; test 429 trên path có tham số |
| 14 | Medium | Test xoá kỳ vọng 4xx trong khi `portalRoute` trả 303 | Phase 01: kỳ vọng đúng 303 và số document không đổi |
| 15 | Medium | CI iOS chỉ lọc `ios/**` nên bỏ sót thay đổi hợp đồng API; `macos-latest` không ghim Xcode | Phase 02/04: test hợp đồng với fixture chung; workflow `ios.yml` riêng, ghim Xcode |
| 16 | Medium | Lệch phạm vi: push thiếu sự kiện đăng nhập mới, có widget, dispatcher chưa bật | Phase 03 thêm bảng sự kiện; bỏ widget; phần rủi ro ghi rõ dispatcher chưa bật |

Các giả định đã kiểm và đứng vững:
- Token opaque mang scope `account` (oidc-provider 9.12.2, `grant_authorization.js:53-55`).
- Có thể giữ trần 90 ngày cho client gắn thiết bị.
- Có thể gắn router riêng cho tenant chính (`src/app.ts:71-98`).
