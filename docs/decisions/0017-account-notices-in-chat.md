# 0017. Thông báo bảo mật qua app Chat

Ngày: 2026-11-13. Trạng thái: chấp nhận.

## Bối cảnh

Thông báo bảo mật của tài khoản chỉ đi qua Telegram (khi người dùng liên kết) và push của app "Tài khoản" (đang dừng cùng App Store). App Chat của hệ sinh thái đã có bot trợ lý hệ thống nhắn riêng cho từng người dùng, và mỗi người dùng Chat lưu sẵn mã tài khoản hoandat.com (`users.idp_sub`). Chủ sở hữu muốn nhận thông báo trong Chat mà không phải làm thêm thao tác liên kết.

## Quyết định

- Không có bước liên kết. Ở `/account`, thẻ "Thông báo bảo mật" có thêm công tắc "Gửi qua Chat"; bật thì IdP gửi theo mã tài khoản, Chat chuyển bằng bot trợ lý của nó. Người chưa có tài khoản Chat thì không nhận gì.
- IdP gửi `POST {CHAT_NOTICES_URL}/api/account-notices` với body `{"text": "..."}` (tối đa 2000 ký tự) và `Authorization: Bearer <token>`. Token do chính IdP ký bằng khoá ES256 chính (`primarySigningKey`), cùng dạng access token mà Chat đã kiểm: header `typ: at+jwt` và `kid`; claim `iss` là issuer, `aud` là `{CHAT_NOTICES_URL}/api/account-notices`, `sub` là mã tài khoản, `client_id: "auth-account-notices"`, `scope: "account-notices"`, `iat`, `exp` sau 60 giây, `jti`. Audience này không phải resource của `oidc-provider` nên không client nào xin được token cho nó. Không có secret mới giữa hai máy chủ.
- Chat kiểm token bằng `VerifyAccessToken` với audience trên, đòi đúng `client_id` và `scope`. Nó trả `204` cả khi không có người dùng mang `sub` đó hoặc trợ lý đang tắt, để IdP không dò được ai có tài khoản Chat.
- Nội dung là bản dịch sẵn có của push (`pushPayload`, tiêu đề và thân), theo ngôn ngữ đã lưu cho thông báo của tài khoản, cho mọi sự kiện push gửi.
- Bật/tắt là thay đổi bảo mật: tăng `securityVersion` và ghi audit `method.linked`/`method.unlinked` với `method: "chat"`, như Telegram. Gửi chạy nền, lỗi chỉ được log, không làm hỏng thao tác bảo mật.
- Kênh chỉ bật khi env `CHAT_NOTICES_URL` có giá trị (mặc định tắt); không có thì công tắc không hiện.

## Hệ quả

- Chat thêm một endpoint ngoài `/rpc`, không phiên người dùng, kiểm bằng token IdP; như ngoại lệ `POST /api/tunelo-agent/grants/revoke` theo chiều ngược lại.
- Lộ khoá ký của IdP thì đằng nào cũng mất toàn bộ hệ thống; kênh này không thêm bề mặt mới.
- Một token bị bắt lại trong 60 giây chỉ gửi trùng một tin cho chính chủ tài khoản; không lưu `jti`.
- Chưa đưa kênh Chat cho Localman qua claim như `telegram_chat_id`.
