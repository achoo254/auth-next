# ADR 0001: Tự host IdP OpenID Connect bằng `oidc-provider`

- Trạng thái: chấp nhận
- Ngày: 2026-10-08
- Phạm vi: `auth.hoandat.com`, phục vụ Localman web, Localman MCP, Tunelo CLI và Tunelo web

## Bối cảnh

Các sản phẩm cá nhân nằm trên nhiều domain (`localman.hoandat.com`, `tunnel.hoandat.com`). Cookie không dùng chung được giữa các domain, nên muốn đăng nhập một lần thì phải có một máy chủ định danh trung tâm nói chuyện với các app bằng OpenID Connect (chuyển hướng trình duyệt), cộng thêm Device Authorization Grant cho CLI và Dynamic Client Registration cho client MCP.

User đã đặt quy tắc: không chạy mail server, không gửi email; thông báo đi qua kênh khác (Telegram).

## Quyết định

### 1. Tự host bằng thư viện `oidc-provider` (panva)

- `oidc-provider` được OpenID Foundation chứng nhận và có sẵn mọi thứ cần dùng: Authorization Code + PKCE, Device Flow (RFC 8628), refresh token xoay vòng, revocation, introspection, RP-initiated và back-channel logout, resource indicators (RFC 8707) và DCR. Tự viết giao thức thì rủi ro sai đặc tả và lỗ hổng bảo mật lớn hơn nhiều.
- Không dùng dịch vụ SaaS (Auth0, Clerk...) vì: chi phí theo số user, dữ liệu tài khoản nằm ngoài, và phần lớn dịch vụ đó dựa vào email để xác minh và khôi phục, trái quy tắc ở trên.
- Không dùng Keycloak/Authentik vì nặng (JVM hoặc nhiều container) so với một VPS nhỏ, trong khi nhu cầu chỉ là vài client tĩnh. `oidc-provider` chạy trong một process Node, dùng chung MongoDB với Localman (database riêng `auth`).
- Trạng thái của provider (session, grant, code, token, client đăng ký động) lưu trong MongoDB qua adapter riêng; mỗi bản ghi có `expiresAt` và TTL index, nên MongoDB tự dọn bản ghi hết hạn.

### 2. Không dùng email

- IdP không có route gửi mail và không có cấu hình SMTP; kiểm bằng `grep -ri "nodemailer\|smtp" src` phải rỗng.
- Email chỉ là định danh đăng nhập. Claim `email_verified` chỉ là `true` khi Google hoặc GitHub đã xác minh email đó; email gõ tay luôn là chưa xác minh, vì IdP không gửi được mail để xác minh.
- Khôi phục tài khoản (phase 02): mã khôi phục dùng một lần, link reset gửi qua Telegram, hoặc đăng nhập bằng Google/GitHub đã liên kết.
- Nếu sau này cần gửi mail thì cắm một dịch vụ gửi mail vào IdP mà không phải đổi app nào; việc đó cần user đồng ý trước.

### 3. ES256 và token ngắn hạn

- Mọi ID token và access token ký bằng ES256 (ECDSA P-256): chữ ký nhỏ, ký và xác minh nhanh, được mọi thư viện JOSE hỗ trợ. Discovery chỉ quảng bá `ES256`.
- Access token là JWT (`typ: at+jwt`, RFC 9068), sống 15 phút, `aud` đúng bằng resource indicator: `https://localman.hoandat.com`, `https://localman.hoandat.com/mcp` hoặc `https://tunnel.hoandat.com`. Mỗi app tự xác minh offline bằng JWKS đã cache (thư viện `jose`), không gọi IdP ở mỗi request; app nào cũng phải kiểm `iss`, `aud` của chính mình, `alg` và `typ`. Vì vậy token của Tunelo không dùng được cho Localman và ngược lại.
- Mỗi client chỉ được xin token cho các resource khai báo sẵn trong `allowed_resources`. Client MCP đăng ký động luôn bị gán đúng `https://localman.hoandat.com/mcp`.
- Token ngắn hạn giới hạn thiệt hại khi lộ token, vì JWT không thu hồi được trước khi hết hạn. Phiên dài hạn dựa vào refresh token: sống 30 ngày, xoay vòng sau mỗi lần dùng; nếu một refresh token đã dùng bị đưa ra lại (dấu hiệu bị đánh cắp) thì cả grant bị thu hồi, kể cả refresh token mới nhất.
- PKCE bắt buộc cho mọi client, kể cả client confidential.

### 4. Khoá ký và cách xoay vòng

- Khoá ký là JWKS private nằm trong file secret (`SIGNING_KEYS_PATH`, mặc định `secrets/signing-keys.json`), mount read-only vào container; thư mục `secrets/` không bao giờ được commit. Mỗi khoá có `kid` bằng thumbprint RFC 7638 của nó.
- Khoá **đầu tiên** trong `keys` dùng để ký; các khoá sau chỉ được công bố ở `/jwks` để xác minh token cũ.
- Quy trình xoay vòng (theo khuyến nghị của `oidc-provider`):
  1. Chạy `pnpm generate-key <đường dẫn file>`: khoá mới được thêm vào **cuối** danh sách, nên chỉ được công bố để xác minh.
  2. Deploy lại. Chờ ít nhất bằng thời gian cache JWKS của các app (để app nào cũng đã thấy khoá mới).
  3. Chuyển khoá mới lên **đầu** danh sách rồi deploy lại: từ đây token mới ký bằng khoá mới.
  4. Giữ khoá cũ trong file thêm ít nhất bằng tuổi thọ dài nhất của token nó đã ký (ID token và access token 15 phút), rồi xoá khỏi file và deploy lại.
- Xoá một khoá khỏi file **không** làm app ngừng tin nó ngay: app vẫn chấp nhận token ký bằng khoá đó cho tới khi bộ cache JWKS của chính app hết hạn và tải lại `/jwks`. Thời gian cache JWKS phía app vì vậy là một phần của thời gian xoay khoá và của thời gian phản ứng khi lộ khoá.
- Khi nghi lộ khoá: bỏ qua bước chờ, đưa khoá mới lên đầu và xoá khoá bị lộ ngay. Từ lúc đó IdP không ký bằng khoá cũ nữa, nhưng token giả ký bằng khoá bị lộ vẫn qua được ở app nào còn giữ JWKS cũ trong cache; cần buộc các app tải lại JWKS (khởi động lại hoặc xoá cache) để chặn hẳn.
- `pnpm generate-key` ghi ra file tạm cạnh file JWKS rồi đổi tên, nên file không bao giờ bị ghi dở.
- Cookie của IdP ký bằng `COOKIE_KEYS` (nhiều khoá, khoá đầu ký); xoay bằng cách thêm khoá mới vào đầu danh sách. Trên https, cookie phiên là `__Host-session` (Secure, `Path=/`, SameSite=Lax); cookie interaction gắn với đường dẫn interaction nên dùng tiền tố `__Secure-`.

## Hệ quả

- Phải tự vận hành thêm một dịch vụ: healthcheck `/healthz`, restart tự động, backup MongoDB hằng ngày. IdP sập thì không đăng nhập mới được, nhưng phiên đang có ở các app vẫn chạy nhờ JWKS đã cache.
- Phải theo dõi bản nâng cấp của `oidc-provider` (API đổi theo major) và chạy lại bộ conformance của OpenID Foundation sau mỗi lần nâng major.
- Trang đăng nhập, consent và duyệt thiết bị do mình viết (phase 02); trước đó mọi interaction trả 501.
