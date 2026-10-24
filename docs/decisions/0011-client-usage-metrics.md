# ADR 0011: Ghi nhận tài khoản đăng nhập vào app nào, để đo tăng trưởng

- Trạng thái: chấp nhận
- Ngày: 2026-10-24
- Phạm vi: `finishLogin`, listener của `oidc-provider`, tầng dữ liệu (collection `client_usage`), xoá tài khoản (ADR 0009), chuyển tenant (ADR 0007), trang `/privacy`, script `growth-report`. Áp dụng cho mọi tenant và mọi bản cài.

## Bối cảnh

Mục tiêu tiếp theo của hệ `*-next` là tăng người dùng: người dùng một app sang được app khác nhờ SSO sẵn có (nút chuyển app ở Chat, Scribe, Localman). Muốn biết thử nghiệm nào có tác dụng thì cần số liệu theo tuần: tài khoản mới, app đầu tiên của tài khoản mới, tỷ lệ tài khoản dùng từ 2 app trở lên, số lượt đăng nhập theo `client_id`.

IdP chưa có nguồn lịch sử nào cho câu hỏi "ai dùng app nào":

- Grant (30–90 ngày) và Session (30 ngày) bị xoá khi hết hạn, khi thu hồi và khi xoá tài khoản.
- `audit_outbox` chỉ giữ 30 ngày sau khi gửi, và `login.succeeded` không có `clientId`.
- `finishLogin` chỉ chạy khi có màn đăng nhập. Lượt vào app bằng phiên IdP còn sống (SSO) không đi qua đó, mà đó chính là lượt "sang app khác" cần đếm.

## Quyết định

### 1. Collection `client_usage`, chỉ ghi thêm

Mỗi lượt app nhận được authorization là một document `{ tenantId, sub, clientId, at, kind }`, `kind` là `interactive` (đăng nhập trên trang của IdP) hoặc `sso` (phiên IdP còn sống, không phải nhập gì). Không IP, không User-Agent, không scope: chỉ đủ để đếm người theo app. Model ở `src/usage/client-usage-model.ts`, ghi qua `ClientUsageRecorder` (`src/usage/client-usage-recorder.ts`), mỗi tenant một recorder trong `createServices`.

Chỉ mục: `{ tenantId, at }` (đọc theo tuần), `{ tenantId, sub, at }` (app đầu tiên của một tài khoản, xoá theo tài khoản) và TTL trên `at`.

### 2. Giữ 400 ngày

TTL `expireAfterSeconds` = 400 ngày: đủ để so một tuần với cùng tuần năm trước, có dư một tháng. Không giữ mãi vì số liệu chỉ phục vụ so sánh xu hướng. Muốn đổi thời hạn thì đổi `CLIENT_USAGE_RETENTION_DAYS` và chạy `collMod` cho chỉ mục `at_ttl` (MongoDB không tự sửa TTL của chỉ mục đã có).

### 3. Ghi ở hai điểm, mỗi lượt một lần

Đã kiểm trong mã nguồn `oidc-provider` 9.12.2 (`lib/actions/authorization/respond.js`, `lib/actions/authorization/device.js`): `authorization.success` phát `(ctx, out)` cho mọi authorization được trả về, ở endpoint authorization lẫn luồng thiết bị, **kể cả** lượt nối tiếp sau màn đăng nhập. Vì thế:

- `finishLogin` ghi `interactive` với `client_id` của interaction, sau `login.succeeded`.
- Listener `authorization.success` (`recordSsoUsage`, `src/audit/provider-events.ts`) ghi `sso` với `ctx.oidc.session.accountId` và `ctx.oidc.client.clientId`, **trừ khi** `ctx.oidc.result.login` có mặt. `resume` đặt `ctx.oidc.result` bằng kết quả interaction; bước consent sau đăng nhập mang theo kết quả đăng nhập (`lastSubmission`, consent dùng `mergeWithLastSubmission: true`). Có `login` nghĩa là lượt này đã được `finishLogin` ghi.

Không dùng cửa sổ khử trùng theo thời gian: cách trên xác định, không cần đọc DB trước khi ghi. Test `client-usage-flow` kiểm cả đăng nhập + consent ẩn (Localman web), đăng nhập + trang duyệt (chat-mobile), SSO web, SSO app native và luồng thiết bị; bỏ điều kiện `result.login` thì test hỏng.

Hệ quả nhỏ đã chấp nhận: lượt đăng nhập xong rồi bị từ chối ở bước consent vẫn được tính `interactive`; authorization `prompt=none` (hiện chưa app nào dùng) được tính `sso`.

### 4. Không làm hỏng đăng nhập

`record` không bao giờ ném lỗi, giống `AuditOutbox.record`: lỗi ghi chỉ log `warn` kèm `clientId`, `kind` và tên lỗi, không kèm tài khoản. Listener không chờ (`void`).

`CLIENT_USAGE_ENABLED=false` (mặc định `true`, `src/config/usage-env.ts`) tắt việc ghi sau khi restart, không cần sửa mã. Rollback là tắt cờ; dữ liệu đã có tự hết theo TTL.

### 5. Tenant và xoá tài khoản

- `client_usage` nằm trong `TENANT_COLLECTIONS` và `IDP_COLLECTIONS` của `deploy/self-hosted/migrate/export-tenant.sh`; mọi đọc ghi qua `inTenant`/`tenantTag`.
- `purgeAccountData` xoá `client_usage` theo `sub` trong tenant (ADR 0009 bước 4), nên xoá tài khoản xoá luôn lịch sử dùng app. `account-deletion.test.ts` kiểm theo `sub`.

### 6. Script đọc số liệu

`node --env-file=.env dist/growth-report.mjs [--weeks N] [--tenant <id>] [--json]` (local: `pnpm growth:report`). Chỉ đọc, không tạo chỉ mục. Tuần bắt đầu thứ Hai 00:00 Asia/Saigon (UTC+7 quanh năm, nên `$dateTrunc` dùng offset `+07:00`), mặc định 8 tuần gần nhất, tuần cuối là tuần đang chạy. Mỗi tenant có dữ liệu một khối:

- **Tài khoản mới:** tài khoản tạo trong tuần, trừ tài khoản người duyệt (`reviewLogin`, ADR 0010). Tài khoản đã xoá không còn được đếm.
- **App đầu tiên:** với mỗi tài khoản mới, app của bản ghi `client_usage` sớm nhất; chưa vào app nào thì là `none`.
- **Dùng từ 2 app:** trong các tài khoản có ít nhất một lượt vào app trong tuần, bao nhiêu tài khoản vào từ 2 app khác nhau.
- **Lượt đăng nhập theo `client_id`:** đếm `interactive`, `sso` và tổng, gồm cả client của chính IdP.

"App" gom client theo sản phẩm (`src/usage/usage-apps.ts`): web, mobile và client dev của cùng một sản phẩm là một app; client DCR (MCP) tính là Localman; `/account` (`hoandat-account`) và app "Tài khoản" (`account-ios`) là quản lý tài khoản, không phải app, nên không tính ở ba chỉ số đầu.

### 7. Quyền riêng tư

`/privacy` (ba ngôn ngữ) ghi thêm: lưu app nào được đăng nhập và lúc nào, không kèm IP hay trình duyệt, giữ 400 ngày; mục đích gồm thống kê tổng hợp số người dùng theo app; không bán, không chia sẻ dữ liệu hay số liệu này; xoá tài khoản xoá luôn lịch sử này. Trang được cập nhật trước khi bản này lên production.

## Hệ quả

- Mỗi lượt vào app thêm một lần ghi nhỏ vào MongoDB; tải không đáng kể so với các lần ghi grant, session, token của cùng lượt đó.
- Không có số liệu trước ngày deploy: Grant và Session đã tự xoá, audit chỉ giữ 30 ngày, nên không backfill.
- Refresh token không tạo bản ghi: app dùng lâu bằng refresh token (chat-mobile, tunelo-cli) chỉ được đếm khi đăng nhập hay qua authorization lại.
- Collection mới gắn tài khoản sau này vẫn theo ADR 0009: phải vào `purgeAccountData`.
