# ADR 0009: Người dùng tự xoá tài khoản

- Trạng thái: chấp nhận
- Ngày: 2026-10-20
- Phạm vi: `/account` của tenant chính trên mọi bản cài (`auth.hoandat.com` và bản tự host theo ADR 0007, nơi tenant của bản cài cũng là tenant chính), tầng tài khoản, audit. Tenant sổ (ADR 0006) không có tính năng này; trang `/privacy` của chúng vẫn ghi email liên hệ.

## Bối cảnh

App iOS "Tài khoản" (plan `plans/dattqh/261020-0742-ios-account-app/`) phải qua App Store Review Guideline 5.1.1(v). Guideline này đòi hai điều:

- app cho tạo tài khoản thì phải cho xoá tài khoản ngay trong app;
- tài khoản có Sign in with Apple thì khi xoá phải thu hồi ở Apple.

Trước ADR này IdP không có chức năng xoá, trang `/privacy` chỉ ghi "liên hệ email". Cùng một chức năng sẽ phục vụ web `/account` (làm trong phase này) và API của app (phase sau). Người dùng bản tự host cũng có cùng quyền xoá tài khoản của mình.

## Quyết định

### 1. Xoá thật, ngay lập tức

Không có thời gian chờ hay cách khôi phục. Tài khoản bị xoá hẳn. Nếu sau đó người dùng đăng nhập lại bằng cùng Google, GitHub hoặc Apple, đó là một lần đăng ký mới với `sub` mới. `sub` cũ không bao giờ được dùng lại.

### 2. Thứ tự (`deleteAccount`, `src/account-portal/account-deletion.ts`)

1. **Khoá tài khoản.** Đặt `disabledAt` và `$inc: { securityVersion: 1 }` trong cùng một câu ghi. Chỉ request nào khoá được thì mới làm tiếp; lần bấm thứ hai thấy tài khoản đã khoá thì dừng, không ghi gì thêm.

   Từ thời điểm này tài khoản không đăng nhập, liên kết, refresh, token exchange hay dùng token một lần được nữa. Một lượt đăng nhập đã được quyết định trước khi khoá cũng bị chặn: `finishLogin` đọc lại tài khoản ngay trước khi hoàn tất. Liên kết đang chạy dở thì thua ở bước ghi có điều kiện theo `securityVersion`.
2. **Thu hồi ở Apple.** Đọc lại tài khoản (sau khi khoá) rồi gọi revoke ở provider cho mọi liên kết có `revocationToken`. Nếu lỗi mạng hoặc Apple đang tắt thì chỉ log, không chặn việc xoá: quyền xoá của người dùng quan trọng hơn, và họ vẫn tự gỡ được ứng dụng trong cài đặt Apple ID.
3. **Đăng xuất mọi phiên** giống như bấm nút "Đăng xuất" (`revokeSession`, có back-channel logout tới các app), rồi thu hồi mọi grant (`revokeGrants`).
4. **Xoá dữ liệu theo `accountId`** ở tầng dữ liệu (`purgeAccountData`), không dựa vào danh sách đã lấy ở các bước trước. Gồm:
   - mọi model `oidc_*` gắn với grant, khớp theo cả `grantId` lẫn `payload.accountId`, nên bắt được cả grant đã hết hạn mà TTL chưa dọn;
   - `oidc_grant`, `oidc_session`, `oidc_interaction`;
   - `session_meta`, `grant_meta`, `one_time_tokens`;
   - claim nhận domain của tài khoản (`tenant_claims`).

   Trong các sự kiện `audit_outbox` của `sub`, xoá IP, User-Agent và tên thiết bị.
5. **Xoá document `accounts`**, chỉ khi tài khoản đã bị khoá.
6. **Quét lại bước 4 một lần nữa**, để dọn những gì một request chạy song song có thể vừa ghi.
7. **Ghi audit `account.deleted`** (`source`: `web` hoặc `app`), không kèm IP hay User-Agent.

Nếu lỗi giữa chừng:
- log ghi `accountId` kèm câu "Account deletion stopped";
- tài khoản vẫn ở trạng thái khoá và không dùng được;
- `dist/finish-account-deletion.mjs <accountId>` chạy lại bước 4–6 từ database, không gọi lại Apple hay back-channel logout (`docs/deployment-guide.md`);
- `/privacy` vẫn ghi email liên hệ để người dùng báo lại.

### 3. Những gì còn lại sau khi xoá

- **Sự kiện audit của `sub`:** chỉ còn loại sự kiện, thời điểm và các giá trị không định danh (ví dụ `method: "google"`, `clientId`). Sự kiện đã gửi sang Localman tự xoá sau 30 ngày; sự kiện chưa gửi nằm lại cho tới khi gửi được.
- **Access token JWT** đã cấp cho resource (Localman, Tunelo) vẫn hợp lệ tới khi hết hạn, tối đa 15 phút, giống như khi đăng xuất.
- **Backup database** trên máy chủ vẫn giữ bản cũ cho tới khi xoay vòng (14 ngày trên .65).
- **Dữ liệu trong các app khác** (project Localman, tin nhắn Chat...) không bị xoá ở bước này; trang xác nhận nói rõ. `account.deleted` đi qua kênh audit sẵn có, để mỗi app tự quyết cách xử lý khi kênh đó được bật.
- **Quyền sở hữu domain** của tenant sổ gắn với danh tính Google/GitHub chứ không gắn với tài khoản, nên vẫn còn. Trang xác nhận nói rõ điều này khi bản cài có tính năng nhận domain.

### 4. Web `/account`

- Card "Xoá tài khoản" nằm cuối trang, nút viền đỏ, mở `GET /account/delete`. Đây là trang xác nhận liệt kê hậu quả.
- `POST /account/delete` dùng `portalRoute(..., { csrf: true, recentLogin: true })` và yêu cầu gõ lại username (có hoặc không có `@`, không phân biệt hoa thường). Gõ sai thì quay về `/account` kèm thông báo, không xoá gì.
- Xoá xong, trình duyệt được chuyển 303 sang `GET /account/deleted`, một trang công khai không cần phiên.
- Trên tenant chính, `/privacy` hướng dẫn tự xoá và vẫn ghi email liên hệ. Tenant sổ chỉ ghi email liên hệ.

## Hệ quả

- `disabledAt` lần đầu có chỗ ghi. Nó chỉ là hàng rào trong lúc xoá, không phải trạng thái lâu dài.
- Collection mới có dữ liệu gắn với tài khoản phải được thêm vào `purgeAccountData`. Test `account-deletion.test.ts` đếm dữ liệu còn sót theo `TENANT_COLLECTIONS`.
- API xoá của app (phase sau) gọi cùng `deleteAccount` với `source: "app"`, kèm một bước xác thực lại tương đương `recentLogin`.
