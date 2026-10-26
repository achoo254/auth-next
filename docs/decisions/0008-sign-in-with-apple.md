# ADR 0008: Thêm "Đăng nhập với Apple" cạnh Google và GitHub

- Trạng thái: chấp nhận (code xong, chờ tài khoản Apple Developer để bật)
- Ngày: 2026-10-19
- Phạm vi: trang đăng nhập/đăng ký, `/account`, tầng tài khoản, `/oauth/apple/*`; mở rộng ADR 0004 mục 1 (danh sách cách đăng nhập). Không đổi gì của tenant sổ (ADR 0006) hay bản tự host (ADR 0007).
- Hết hiệu lực một phần: câu về tenant sổ ở mục 1 bỏ theo [ADR 0013](0013-single-tenant.md) (chỉ còn một tenant, Apple áp cho nó); câu "IdP chưa có xoá tài khoản" ở mục 4 bị [ADR 0009](0009-account-deletion.md) thay (xoá tài khoản gọi `revokeUnlinked`).

## Bối cảnh

App iPhone Scribe đăng nhập qua IdP (client `scribe-mobile`, trình duyệt hệ thống / `ASWebAuthenticationSession`). App Store Review Guideline 4.8 đòi app dùng đăng nhập bên thứ ba (Google, GitHub) phải có thêm một lựa chọn bảo vệ quyền riêng tư tương đương; "Sign in with Apple" thoả điều đó. ADR 0004 chỉ cho Google/GitHub và cấm thêm đường vào mới khi không có ADR: ADR này là ADR đó. Tài khoản Apple Developer trả phí của chủ sở hữu đang chờ duyệt, nên code đi trước, cấu hình sau (`docs/sign-in-with-apple.md`).

## Quyết định

### 1. Apple là provider upstream thứ ba, chỉ cho tenant chính

- `UPSTREAM_PROVIDERS = ["apple", "google", "github"]`: Apple đứng đầu, nút cùng cỡ, theo Human Interface Guidelines của Apple (nút đặc, đen trên nền sáng, trắng trên nền tối, logo Apple, "Đăng nhập với Apple"/"Sign in with Apple"/"使用 Apple 登录").
- Bật khi đủ bốn biến `APPLE_TEAM_ID`, `APPLE_SERVICES_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_PATH` (thiếu một biến thì process không khởi động, như các nhóm khác); không đặt gì thì nút ẩn, route `/oauth/apple/*` trả 404. Redirect URI không cấu hình riêng: luôn `${ISSUER}/oauth/apple/callback` như Google/GitHub. File khoá `.p8` đọc và kiểm (EC P-256) lúc khởi động; lỗi chỉ nêu tên biến, không in nội dung.
- Tenant sổ không có Apple (cần tài khoản developer trả phí và khoá riêng): `/admin` và chủ sở hữu tenant chỉ dùng `TENANT_OAUTH_PROVIDERS = ["google", "github"]`; danh tính Apple không làm owner của domain được.

### 2. Luồng web

- Authorization Code, `response_mode=form_post` (Apple bắt buộc khi xin `name email`), `state` + `nonce`; Apple không hỗ trợ PKCE nên không gửi `code_challenge`. Metadata Apple ghi tĩnh trong `upstream-apple.ts`.
- `client_secret` là JWT ES256 ký bằng khoá `.p8` (`iss` Team ID, `sub` Services ID, `aud` `https://appleid.apple.com`, `kid` Key ID), sống 5 phút, tạo mới cho từng lần gọi token/revoke, không lưu.
- ID token: `openid-client` kiểm issuer, audience, hạn, nonce; `jose` kiểm thêm chữ ký theo JWKS của Apple (`/auth/keys`).
- **Cookie state và form_post.** Cookie state là `SameSite=Lax`, không đi theo POST cross-site từ `appleid.apple.com`. `POST /oauth/apple/callback` vì thế không kiểm gì ngoài dạng của `state`: nó cất `code`, `user`, `error` vào `one_time_tokens` (kind `upstream-form-post`, khoá là hash của state, 2 phút, dùng một lần) rồi trả 303 về `GET /oauth/apple/callback?state=…`. GET đó là điều hướng top-level an toàn nên trình duyệt gửi cookie Lax; mọi kiểm tra cũ (state khớp cookie, state một lần, purpose, binding) chạy ở đó như với Google/GitHub. URL chỉ chứa state (nginx đã che query của path này). Không dùng cookie `SameSite=None`.

### 3. Tài khoản

- `providers.apple` là `sub` của Apple (ổn định theo team), chỉ mục unique `tenant_providers_apple`.
- Luật liên kết giữ nguyên (ADR 0002 mục 9): Apple coi như xác minh email nó trả (`email_verified`), nên email thật trùng tài khoản đã xác minh thì tự liên kết. Địa chỉ chuyển tiếp `@privaterelay.appleid.com` không trùng tài khoản nào nên tạo tài khoản mới: đúng ý, ghi trong tài liệu cho người dùng và app.
- Tên chỉ đến ở lần cấp quyền đầu (trường `user` của form_post) và chỉ dùng làm `name` ban đầu. Sau đó Apple có thể không gửi email: đăng nhập theo `sub` đã liên kết không cần email; `sub` chưa liên kết mà không có email thì bị từ chối như provider không có email đã xác minh.
- `providerDetails.apple.revocationToken` giữ refresh token của Apple, chỉ để thu hồi. Lưu thô như `oidc-provider` lưu refresh token của chính nó: token chỉ dùng được kèm `client_secret` ký bằng khoá `.p8` nằm ngoài database; không bao giờ hiện ra trang hay log (logger che `*.revocationToken`).

### 4. Thu hồi và thông báo của Apple

- Huỷ liên kết Apple ở `/account`: sau khi lệnh ghi thành công, IdP gọi `https://appleid.apple.com/auth/revoke` với token đã lưu (best effort, lỗi chỉ log). Luật "không huỷ được cách đăng nhập cuối cùng" tổng quát cho mọi provider: lệnh ghi đòi ít nhất một provider khác còn liên kết.
- IdP chưa có xoá tài khoản (chính sách: liên hệ email). Khi thêm, phải gọi cùng `revokeUnlinked` cho Apple trước khi xoá (Guideline 5.1.1(v)).
- `POST /oauth/apple/notifications` nhận `{ "payload": JWS }`, kiểm chữ ký Apple, `iss`, `aud` (Services ID hoặc `APPLE_PRIMARY_APP_ID`). `consent-revoked` và `account-deleted`: bỏ `revocationToken` (Apple đã vô hiệu nó), **giữ** liên kết để tài khoản không âm thầm mất cách vào; người dùng tự huỷ ở `/account`. `email-enabled`/`email-disabled`: chỉ log (IdP không gửi email). Log không chứa `sub` hay payload.

### 5. App native

- Scribe iPhone dùng luồng web này trong `ASWebAuthenticationSession`; Guideline 4.8 chấp nhận Sign in with Apple qua web, nên app không cần AuthenticationServices. Nếu sau này muốn nút Apple native trong app, app sẽ nhận ID token có `aud` là bundle ID của app, IdP không nhận trực tiếp được: cần một ADR mới (đổi token Apple lấy phiên IdP).

## Hệ quả

- Người dùng chọn "Ẩn email" có tài khoản với email chuyển tiếp; app tích hợp nhận email đó ở `userinfo` với `email_verified: true`. Gửi mail tới đó cần đăng ký domain gửi ở Apple; IdP không gửi email nên không cần.
- Một người đã có tài khoản Google/GitHub mà đăng nhập Apple với email ẩn sẽ có tài khoản thứ hai; muốn gộp thì đăng nhập tài khoản cũ rồi "Liên kết Apple" ở `/account`.
- Audit không thêm loại sự kiện: liên kết/gỡ Apple đi qua `method.linked`/`method.unlinked` với `method: "apple"`. Localman chỉ hành động trên Telegram cho hai loại này nên không cần đổi.
