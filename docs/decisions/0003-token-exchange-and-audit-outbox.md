# ADR 0003: Token exchange cho Localman, kiểm client tĩnh, outbox sự kiện audit

- Trạng thái: chấp nhận
- Ngày: 2026-10-08
- Phạm vi: phase 03 của IdP (tích hợp Localman, Tunelo, MCP)

> Cập nhật 2026-10-10: từ [ADR 0004](0004-upstream-only-sign-in.md) không còn mật khẩu, nên IdP không còn phát `login.failed`, `login.locked`, `password.changed`, `password.reset`, `recovery_codes.regenerated`, và không còn đặt lại mật khẩu để thu hồi grant (mục 1, 3 nói về các điều đó là lịch sử). Hợp đồng SET với Localman không đổi.

## Bối cảnh

Phase 03 nối bốn client vào IdP. Có ba việc cần quyết định kiến trúc: Localman phải gọi được API liệt kê tunnel của Tunelo thay cho user; client phải có mặt ở staging và production ("seed"); và IdP phải đẩy sự kiện credential sang audit log của Localman (Jev 0.94) mà không mất sự kiện khi Localman chưa chạy.

## Quyết định

### 1. Token exchange (RFC 8693) chỉ cho `localman-web`

- Grant `urn:ietf:params:oauth:grant-type:token-exchange` đăng ký bằng `provider.registerGrantType` (`src/oidc/token-exchange.ts`). Chỉ `localman-web` có grant này trong `grant_types`; client khác (kể cả client DCR, vì policy DCR chỉ cho `authorization_code` và `refresh_token`) bị từ chối. `oidc-provider` trả `invalid_request` cho grant không có trong `grant_types`; một middleware sau đổi thành `unauthorized_client` cho đúng RFC 6749 §5.2. Handler kiểm lại `client_id` lần nữa để một thay đổi cấu hình không âm thầm mở rộng quyền.
- Đích duy nhất là `https://tunnel.hoandat.com` (qua `resource` hoặc `audience`, bắt buộc có), scope duy nhất `tunnels:read` (mặc định khi bỏ trống). Sai đích trả `invalid_target`, sai scope trả `invalid_scope`.
- `subject_token` phải là **access token opaque** mà IdP cấp cho chính `localman-web` lúc đăng nhập (`subject_token_type` là access token). IdP tra token trong MongoDB (`AccessToken.find`: chưa hết hạn, chưa bị thu hồi), rồi kiểm grant của nó còn tồn tại và thuộc đúng client và user, rồi kiểm tài khoản còn hoạt động và không đang chờ rà soát bảo mật. Access token JWT bị từ chối: JWT không mang grant id nên không biết grant đã bị thu hồi hay chưa.
  - Bất biến `securityVersion` được giữ qua grant: đặt lại mật khẩu thu hồi mọi grant (ADR 0002 mục 8), mà token opaque chết cùng grant, nên token có từ trước lần reset không đổi được nữa. Đổi mật khẩu ở `/account` mà bỏ ô "đăng xuất mọi nơi" thì grant vẫn sống, đúng với quyết định Jev 0.80; vì vậy IdP không so `securityVersion` trực tiếp.
- Lỗi về subject token trả `invalid_request`, không phải `invalid_grant`, vì RFC 8693 §2.2.2 bắt buộc vậy ("the value of the error parameter MUST be the invalid_request error code"). Lỗi xác thực client là `invalid_client` (401).
- Token cấp ra: JWT ES256 `typ: at+jwt`, `aud=https://tunnel.hoandat.com`, `sub` giữ nguyên, `scope=tunnels:read`, `client_id` và `azp` là `localman-web`, `act: {"sub": "localman-web"}` (RFC 8693 §4.1), sống 15 phút. Không có refresh token và không có ID token: hết hạn thì Localman đổi lại bằng access token mới của phiên.
- Token cấp ra không lưu ở MongoDB (định dạng JWT), nên thu hồi grant gốc không thu hồi được nó; nó hết hạn trong tối đa 15 phút, như mọi access token JWT khác.

### 2. Client tĩnh nằm trong code; "seed" là kiểm tra, không ghi

- `oidc-provider` đọc client tĩnh từ cấu hình (`src/oidc/clients.ts`, dựng từ env) và ưu tiên chúng hơn mọi bản ghi trong MongoDB; chỉ client DCR được lưu ở collection `oidc_client`. Ghi client tĩnh vào MongoDB vì vậy vô ích, lại tạo ra hai nguồn sự thật. Mọi môi trường (kể cả `hoandat-account`, ADR 0002) có đủ client chỉ cần deploy đúng code và env.
- `scripts/seed-clients.ts` (`pnpm seed:clients`, hoặc `node dist/seed-clients.mjs` trong image production) vì vậy chỉ đọc: parse env như server (thiếu secret thì báo tên biến, không in giá trị), cho từng client tĩnh đi qua validator của `oidc-provider`, đếm client DCR, báo bản ghi MongoDB nào trùng id client tĩnh (bị che, coi là lỗi), in kế hoạch kèm fingerprint SHA-256 của cấu hình (không chứa secret), và mặc định kiểm discovery cùng JWKS của issuer đang chạy (khoá ký hiện tại phải được công bố). Không ghi gì, nên chạy bao nhiêu lần cũng cho cùng kết quả; test chứng minh bằng snapshot toàn bộ database trước và sau hai lần chạy.
- Index vẫn do server tạo lúc khởi động (`ensureOidcIndexes`, `ensureAccountLayerIndexes`).

### 3. Outbox audit trong MongoDB, đẩy sang Localman dạng SET

- Sự kiện (kiểu cố định trong `src/audit/audit-events.ts`, không trường nào chứa mật khẩu, mã, token hay link): `login.succeeded`; `login.failed` (bí mật sai, hoặc Google/GitHub bị từ chối lúc chờ rà soát; chỉ khi tài khoản tồn tại); `login.locked`; `password.changed`, `password.reset`; `recovery_codes.regenerated`; `method.linked`, `method.unlinked` (Google, GitHub, Telegram); `email.reclaimed`; `grant.created` (duyệt máy Tunelo kèm tên máy đã lọc ký tự điều khiển và cắt 64 ký tự, consent client MCP; Jev 0.96); `session.revoked`, `grant.revoked` (kể cả client thu hồi refresh token ở `/token/revocation`); `session.logout` (RP-initiated).
- **Audit không bao giờ cản bước bảo mật.** Sự kiện ghi vào collection `audit_outbox` **sau** thao tác nó mô tả (thu hồi phiên/grant, huỷ token một lần, bật rà soát), trong cùng request. `AuditOutbox.record` không ném lỗi: ghi thất bại thì log loại sự kiện và id tài khoản rồi đi tiếp (sự kiện đó mất, nhưng bước bảo mật đã xong). Thay đổi liên kết, mã khôi phục và email bị lấy lại được ghi ở tầng dữ liệu (`AccountLinks`, `AccountRepository`), nên không route nào bỏ sót; đăng nhập ở `finishLogin` và các route kiểm bí mật; mật khẩu ở `afterPasswordChange`; thu hồi ở `revokeAccountAccess` và route `/account`; thu hồi và đăng xuất ở endpoint của `oidc-provider` qua listener sự kiện của provider. Không dùng transaction (MongoDB của test chạy standalone).
- **Đăng nhập sai và khoá.** Sự kiện của lượt sai ghi sau khi đã trả response, nên tài khoản có hay không có tồn tại đều trả lời cùng thời gian. Lượt bị khoá từ chối (không kiểm bí mật) không ghi gì, nên kẻ tấn công không làm phình outbox bằng request vào tài khoản đã khoá. Khoá chỉ sinh một `login.locked`: `reservation.fail()` đặt khoá có điều kiện "chưa khoá" và báo `accountLocked` cho đúng một lượt.
- **Dispatcher** (`src/audit/audit-dispatcher.ts`) luôn chạy. Có đủ `AUDIT_EVENTS_URL`, `AUDIT_CLIENT_ID`, `AUDIT_CLIENT_SECRET` thì gửi; thiếu cả ba thì sự kiện nằm chờ (đợt 0–1, Localman chưa deploy) và dispatcher chỉ dọn dữ liệu cũ.
  - Lấy sự kiện đến hạn theo **thời điểm xảy ra** (cũ trước), không theo `nextAttemptAt`, để một loạt sự kiện mới không đẩy lùi sự kiện cũ. Mỗi lần lấy gắn `leaseId` ngẫu nhiên; kết quả (đã gửi, lỗi, trả lại) chỉ được lưu nếu lease vẫn của mình, nên một dispatcher chậm không ghi đè kết quả của dispatcher đã nhận lại sự kiện.
  - `POST` với `Content-Type: application/secevent+jwt`, `Authorization: Basic base64(id:secret)` đúng nguyên văn (không URL-encode; env cấm `:` trong id và cấm user:pass trong URL), `Idempotency-Key` bằng id sự kiện. 2xx thì đánh dấu đã gửi (giữ 30 ngày rồi TTL xoá); mọi kết quả khác giữ sự kiện, thử lại sau 5 giây nhân đôi, trần 1 giờ, không bao giờ bỏ. Không đọc hay log body phản hồi.
  - Sự kiện chờ quá 30 ngày bị xoá IP và User-Agent (mỗi giờ quét một lần), để dữ liệu cá nhân không nằm vô hạn khi Localman chưa nhận.
- Payload là Security Event Token (RFC 8417) ký ES256 bằng khoá ký hiện tại của IdP (`kid` trong header, công bố ở `/jwks`), header `typ: secevent+jwt` để không thể bị nhầm với access token hay ID token: `iss`, `aud` (**đúng URL** `AUDIT_EVENTS_URL`), `iat`, `exp` (10 phút sau lúc ký; mỗi lần thử ký lại), `jti` (id sự kiện, ổn định qua mọi lần thử), `sub`, `toe` (lúc xảy ra), và `events: {"urn:hoandat:auth:event:<loại>": {...dữ liệu, ip, user_agent}}`.
- Shutdown: dispatcher dừng trước khi đóng MongoDB; lần gửi đang dở bị huỷ và sự kiện được trả lại outbox nguyên trạng.
- "Client credentials của IdP" hiện là cặp id/secret cấu hình bằng env (HTTP Basic). Khi service account và grant `client_credentials` có ở IdP (plan devops phase 01), có thể chuyển sang bearer token do IdP tự cấp mà không đổi định dạng sự kiện.

### 4. Back-channel logout cho `tunelo-web`

`tunelo-web` có `backchannel_logout_uri = ${TUNELO_WEB_URL}/auth/backchannel-logout` (`session_required`), giống `localman-web`, để "đăng xuất ở IdP thì mọi app mất phiên" áp cho cả trang web Tunelo. Khi Tunelo chưa có route đó, logout token không tới được (`oidc-provider` phát sự kiện `backchannel.error`), nhưng việc đăng xuất ở IdP vẫn hoàn tất.

### 5. Phiên Localman gắn với phiên IdP (Jev 0.94)

- `localman-web` không có `offline_access` trong scope. IdP vẫn cấp refresh token cho nó (`issueRefreshToken` qua `refreshesWithSession`, như client MCP), nhưng refresh token và access token opaque mang `expiresWithSession`, và grant không `persistsLogout`. Đăng xuất ở IdP (hay phiên IdP bị thu hồi) vì vậy thu hồi grant: refresh trả `invalid_grant`, token exchange trả `invalid_request`.
- Back-channel logout vẫn bắt buộc cho Localman: refresh token chết không xoá được cookie `__Host-lm_session` đang mở; logout token mới làm việc đó ngay.

### 6. Vận hành provider

- `features.revocation.allowedPolicy` khai tường minh: client chỉ thu hồi token của chính nó (hết NOTICE của thư viện).
- `backchannel.error` được log với `clientId` và mã lỗi (HTTP status hoặc mã mạng), không bao giờ có token hay `sid`. Logger che thêm `subject_token`, `actor_token`.

### 7. Scope `telegram`: chat đã liên kết cho thông báo của Localman

- Localman gửi thông báo bằng bot riêng nên cần `chatId` (plan Localman phase 02). Scope mới `telegram` chỉ có trong `scope` của `localman-web`; `oidc-provider` từ chối scope tĩnh không có trong client (`invalid_scope`), còn policy DCR chỉ cho `mock:*`/`client:*`, nên client MCP, `tunelo-*` và `hoandat-account` không xin được.
- Claim `telegram_chat_id` (chuỗi) và `telegram_username` chỉ được trả ở **userinfo** (`claims(use)` bỏ chúng khi `use` là `id_token`, kể cả khi client xin qua tham số `claims`); access token JWT không bao giờ mang claim hồ sơ. Lý do: ID token đi qua trình duyệt và hay bị log ở phía app, còn `chatId` là định danh liên lạc trực tiếp. Chưa liên kết thì không có claim; `telegram_linked` giữ nguyên.
- Không hỏi consent vì `localman-web` là app first-party (ADR 0002); user thấy và gỡ liên kết ở `/account`.
- Đổi hoặc gỡ chat đã tăng `securityVersion` và sinh `method.linked`/`method.unlinked` (`method: "telegram"`) trong outbox audit; Localman dựa vào đó và vào mỗi lần đăng nhập/refresh để đọc lại `userinfo`.

### 8. `prompt=create` qua interaction policy

- Localman có nút "Bắt đầu miễn phí" gửi `prompt=create` (OpenID Connect Prompt Create 1.0). `oidc-provider` 9.12.2 chỉ nhận giá trị `prompt` là tên của một prompt `requestable` trong interaction policy, nên IdP thêm prompt `create` (requestable) **trước** `login` trong `src/oidc/interaction-policy.ts`; discovery quảng bá `prompt_values_supported` tính từ chính policy đó (thư viện không tự quảng bá trường này).
- Check mặc định của prompt requestable chỉ coi là xong khi kết quả interaction có khoá trùng tên prompt; IdP thay nó bằng check cùng tên: `create` còn chờ khi request có `prompt=create` và interaction chưa có kết quả `login`. Vì vậy bất kỳ lần hoàn tất đăng nhập nào (tài khoản mới, Google/GitHub, hay đăng nhập bằng link "Đã có tài khoản?") cũng trả lời prompt này mà không phải sửa `finishLogin`; khi đã có phiên, prompt vẫn hiện (theo spec).
- Trang interaction hiện đăng ký khi prompt là `create`; `GET /interaction/:uid/login` hiện trang đăng nhập cho cùng interaction. Các route đăng ký, Google/GitHub chấp nhận cả `login` lẫn `create` (`isSignInPrompt`). `none` đi cùng giá trị khác bị chính thư viện từ chối (`invalid_request`).

## Hệ quả

- Localman phải giữ access token opaque của phiên (đăng nhập không kèm `resource` và không xin scope API Localman) để đổi token Tunelo; hướng dẫn ở `docs/integration-guide.md`.
- Lookup workspace (`GET /internal/users/:sub/workspaces`) chưa có consumer ở IdP nên chưa làm; khi trang service account ra đời thì gọi bằng client credentials và cache 60 giây.
- Localman phải xác minh SET bằng JWKS của IdP, kiểm `typ`, `iss`, `aud` (URL đầy đủ), `exp`, và bỏ trùng theo `jti`.
- Thu hồi access token (không phải refresh token) ở `/token/revocation` xoá mọi token của grant nhưng giữ grant (mặc định của `oidc-provider`), nên không sinh `grant.revoked`.
