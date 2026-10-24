# ADR 0011: Ghi nhận tài khoản đăng nhập vào app nào, để đo tăng trưởng

- Trạng thái: chấp nhận
- Ngày: 2026-10-24 (sửa cùng ngày: ghi ở một điểm, bỏ tài khoản người duyệt khỏi mọi chỉ số, thêm cửa sổ 28 ngày, `--weeks` tối đa 57)
- Phạm vi: listener `authorization.success` của `oidc-provider`, tầng dữ liệu (collection `client_usage`), xoá tài khoản (ADR 0009), trang `/privacy`, script `growth-report`.
- Sửa 24/10/2026 (ADR 0013): IdP chỉ còn tenant `primary`; bỏ phần chuyển tenant tự host. Script vẫn đọc theo `tenantId` như cũ.

## Bối cảnh

Mục tiêu tiếp theo của hệ `*-next` là tăng người dùng: người dùng một app sang được app khác nhờ SSO sẵn có (nút chuyển app ở Chat, Scribe, Localman). Muốn biết thử nghiệm nào có tác dụng thì cần số liệu theo tuần: tài khoản mới, app đầu tiên của tài khoản mới, tỷ lệ tài khoản dùng từ 2 app trở lên, số lượt đăng nhập theo `client_id`.

IdP chưa có nguồn lịch sử nào cho câu hỏi "ai dùng app nào":

- Grant (30–90 ngày) và Session (30 ngày) bị xoá khi hết hạn, khi thu hồi và khi xoá tài khoản.
- `audit_outbox` chỉ giữ 30 ngày sau khi gửi, và `login.succeeded` không có `clientId`.
- `finishLogin` chỉ chạy khi có màn đăng nhập. Lượt vào app bằng phiên IdP còn sống (SSO) không đi qua đó, mà đó chính là lượt "sang app khác" cần đếm. Đăng nhập xong cũng chưa chắc app nhận được authorization (người dùng có thể từ chối ở bước consent).

## Quyết định

### 1. Collection `client_usage`, chỉ ghi thêm

Mỗi lượt app nhận được authorization là một document `{ tenantId, sub, clientId, at, kind }`, `kind` là `interactive` (đăng nhập trên trang của IdP) hoặc `sso` (phiên IdP còn sống, không phải nhập gì). Không IP, không User-Agent, không scope: chỉ đủ để đếm người theo app. Model ở `src/usage/client-usage-model.ts`, ghi qua `ClientUsageRecorder` (`src/usage/client-usage-recorder.ts`), mỗi tenant một recorder trong `createServices`.

Chỉ mục: `{ tenantId, at }` (đọc theo tuần), `{ tenantId, sub, at }` (app đầu tiên của một tài khoản, xoá theo tài khoản) và TTL trên `at`.

### 2. Giữ 400 ngày

TTL `expireAfterSeconds` = 400 ngày: đủ để so một tuần với cùng tuần năm trước, có dư một tháng. Không giữ mãi vì số liệu chỉ phục vụ so sánh xu hướng. Muốn đổi thời hạn thì đổi `CLIENT_USAGE_RETENTION_DAYS` và chạy `collMod` cho chỉ mục `at_ttl` (MongoDB không tự sửa TTL của chỉ mục đã có).

### 3. Ghi ở một điểm, mỗi lượt một lần

Chỉ listener `authorization.success` (`recordClientUsage`, `src/audit/provider-events.ts`) ghi, với `ctx.oidc.session.accountId`, `ctx.oidc.client.clientId` và `kind = ctx.oidc.result?.login ? "interactive" : "sso"`. `finishLogin` không ghi.

Đã kiểm trong mã nguồn `oidc-provider` 9.12.2:

- `lib/actions/authorization/index.js`: `resume` chạy cho cả `resume` (endpoint authorization) và `device_resume` (luồng thiết bị); `respond` chỉ cho endpoint authorization, `deviceUserFlowResponse` cho luồng thiết bị.
- `respond.js:43` phát `authorization.success` với `(ctx, out)`; `device.js:132` phát `(ctx)` sau khi lưu device code, tức là sau `resume` khi người dùng phải đăng nhập.
- `resume.js:108` đặt `ctx.oidc.result` bằng kết quả interaction, sau khi ném lỗi nếu kết quả là lỗi (`access_denied` khi từ chối). Bước consent sau đăng nhập mang theo kết quả đăng nhập (`lastSubmission`, consent dùng `mergeWithLastSubmission: true`).

Vì thế: có `result.login` nghĩa là người dùng vừa đăng nhập trên trang của IdP cho chính lượt này (`interactive`); không có thì phiên IdP còn sống cho qua (`sso`). Lượt đăng nhập rồi bị từ chối ở consent không phát sự kiện nên không được tính (bản đầu ghi ở `finishLogin` nên tính thừa lượt này). Không dùng cửa sổ khử trùng theo thời gian, không đọc DB trước khi ghi.

Test `client-usage-flow` chờ số bản ghi đứng yên rồi mới so đúng danh sách, cho: đăng nhập + consent ẩn (Localman web), đăng nhập + trang duyệt (chat-mobile), đăng nhập rồi từ chối ở trang duyệt (không bản ghi nào), SSO web, SSO app native, luồng thiết bị với phiên sẵn có (`sso`) và luồng thiết bị phải đăng nhập (`interactive`).

Hệ quả nhỏ đã chấp nhận: authorization `prompt=none` (hiện chưa app nào dùng) được tính `sso`.

### 4. Không làm hỏng đăng nhập

`record` không bao giờ ném lỗi, giống `AuditOutbox.record`: lỗi ghi chỉ log `warn` kèm `clientId`, `kind` và tên lỗi, không kèm tài khoản. Listener không chờ (`void`).

`CLIENT_USAGE_ENABLED=false` (mặc định `true`, `src/config/usage-env.ts`) tắt việc ghi sau khi restart, không cần sửa mã. Rollback là tắt cờ; dữ liệu đã có tự hết theo TTL.

### 5. Tenant và xoá tài khoản

- `client_usage` nằm trong `TENANT_COLLECTIONS`; mọi đọc ghi qua `inTenant`/`tenantTag`.
- `purgeAccountData` xoá `client_usage` theo `sub` trong tenant (ADR 0009 bước 4), nên xoá tài khoản xoá luôn lịch sử dùng app. `account-deletion.test.ts` kiểm theo `sub`.

### 6. Script đọc số liệu

`node --env-file=.env dist/growth-report.mjs [--weeks N] [--tenant <id>] [--json]` (local: `pnpm growth:report`). Chỉ đọc, không tạo chỉ mục. Tuần bắt đầu thứ Hai 00:00 Asia/Saigon (UTC+7 quanh năm, nên `$dateTrunc` dùng offset `+07:00`), mặc định 8 tuần gần nhất, tuần cuối là tuần đang chạy. Mỗi tenant có dữ liệu một khối (từ ADR 0013 chỉ còn `primary`). Tài khoản người duyệt App Store (`reviewLogin`, ADR 0010) bị bỏ khỏi **mọi** chỉ số dưới đây, kể cả lượt đăng nhập theo `client_id`.

- **Tài khoản mới:** tài khoản tạo trong tuần. Tài khoản đã xoá không còn được đếm.
- **App đầu tiên:** với mỗi tài khoản mới, app của bản ghi `client_usage` sớm nhất; chưa vào app nào thì là `none`.
- **Dùng từ 2 app:** trong các tài khoản có ít nhất một lượt vào app trong tuần, bao nhiêu tài khoản vào từ 2 app khác nhau.
- **Lượt đăng nhập theo `client_id`:** đếm `interactive`, `sso` và tổng, gồm cả client của chính IdP.
- **28 ngày gần nhất** (`rolling` trong `--json`, tính đến lúc chạy, không theo tuần): số tài khoản có ít nhất một lượt vào app trong 28 ngày, và bao nhiêu trong số đó vào từ 2 app khác nhau (cùng cách gom app). App giữ phiên riêng nhiều tuần, nên người dùng 2 app thường chỉ chạm một app trong một tuần: chỉ số "dùng từ 2 app" theo tuần đếm thiếu. Vẫn giữ chỉ số theo tuần để so xu hướng.

`--weeks` từ 1 đến 57 (`MAX_REPORT_WEEKS = floor(400 / 7)`): tuần cũ nhất bắt đầu chưa tới 399 ngày trước, nên mọi tuần hiển thị còn nguyên dữ liệu trong TTL 400 ngày. Chọn chặn thay vì đánh dấu tuần thiếu dữ liệu vì đơn giản hơn và không có tuần nào nửa vời. Đổi `CLIENT_USAGE_RETENTION_DAYS` thì giới hạn đổi theo.

"App" gom client theo sản phẩm (`src/usage/usage-apps.ts`): web, mobile và client dev của cùng một sản phẩm là một app; client DCR (MCP) tính là Localman; `/account` (`hoandat-account`) và app "Tài khoản" (`account-ios`) là quản lý tài khoản, không phải app, nên chỉ được đếm ở lượt đăng nhập theo `client_id`, không ở các chỉ số theo app.

### 7. Quyền riêng tư

`/privacy` (ba ngôn ngữ) ghi thêm: lưu app nào được đăng nhập và lúc nào, không kèm IP hay trình duyệt, giữ 400 ngày; mục đích gồm thống kê tổng hợp số người dùng theo app; không bán, không chia sẻ dữ liệu hay số liệu này; xoá tài khoản xoá luôn lịch sử này. Trang được cập nhật trước khi bản này lên production.

## Hệ quả

- Mỗi lượt vào app thêm một lần ghi nhỏ vào MongoDB; tải không đáng kể so với các lần ghi grant, session, token của cùng lượt đó.
- Không có số liệu trước ngày deploy: Grant và Session đã tự xoá, audit chỉ giữ 30 ngày, nên không backfill.
- Refresh token không tạo bản ghi: app dùng lâu bằng refresh token (chat-mobile, tunelo-cli) chỉ được đếm khi đăng nhập hay qua authorization lại.
- Collection mới gắn tài khoản sau này vẫn theo ADR 0009: phải vào `purgeAccountData`.
