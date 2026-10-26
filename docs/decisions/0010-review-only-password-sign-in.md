# ADR 0010: Đăng nhập bằng mật khẩu chỉ cho người duyệt ứng dụng

- Trạng thái: chấp nhận
- Ngày: 2026-10-20
- Phạm vi: trang đăng nhập của interaction ở tenant chính, tầng tài khoản, audit. Ngoại lệ duy nhất của ADR 0004 ("không mật khẩu"); tenant sổ (ADR 0006) không bao giờ có.
- Hết hiệu lực một phần: tenant sổ không còn từ [ADR 0013](0013-single-tenant.md); các câu "chỉ tenant chính" nay áp cho tenant duy nhất.

## Bối cảnh

App iPhone Scribe (client `scribe-mobile`) đăng nhập bằng trang của IdP trong `ASWebAuthenticationSession`. App Store Review Guideline 2.1 đòi app có đăng nhập phải đưa người duyệt một tài khoản demo dùng được ngay. IdP chỉ có Google/GitHub/Apple (ADR 0004, 0008); người duyệt không qua được bước xác minh thiết bị mới của Google/GitHub, và không có Apple ID nào của ta để đưa họ. Chủ sản phẩm duyệt cách này ngày 2026-10-20 (Jev 0.88).

## Quyết định

### 1. Một tài khoản, tắt mặc định

- Chỉ bật khi đặt **cả hai** biến: `REVIEW_LOGIN_EMAIL` (một địa chỉ, chuẩn hoá chữ thường) và `REVIEW_LOGIN_PASSWORD_HASH_PATH` (file mode 600 chứa hash). Thiếu một biến, email sai dạng, file không đọc được, đọc được bởi group/other hay không phải hash hợp lệ thì IdP không khởi động; thông báo nêu tên biến, không bao giờ in nội dung (`src/config/review-login-env.ts`).
- Chỉ tenant chính: `createServices` không đọc cấu hình này khi dựng tenant sổ (`integrations`).
- Tắt: route `/interaction/:uid/review` không được đăng ký (404) và trang đăng nhập không có link.
- Dùng xong (App Review duyệt) thì tắt: xoá hai biến, restart.

### 2. Hash

- `crypto.scrypt` có sẵn của Node, không thêm dependency. Dạng tự mô tả `$scrypt$ln=15,r=8,p=1$<salt>$<hash>` (base64url), so sánh `timingSafeEqual` (`src/accounts/review-password-hash.ts`). Tham số khi đọc bị giới hạn (`ln` 14–17, `r` 1–8, `p` 1–4) để một file sai không làm treo hay ngốn RAM.
- Sinh bằng `pnpm -s review-login:hash`, mật khẩu đọc từ stdin (không bao giờ là tham số dòng lệnh), chỉ in hash. Hash được đọc một lần lúc khởi động; đổi mật khẩu thì thay file và restart.

### 3. Trang và kiểm tra

- Khi bật, dưới các nút provider có link nhỏ "Tài khoản dành cho người duyệt ứng dụng" tới `/interaction/:uid/review`: form email + mật khẩu, CSRF `csrfScope(uid)`, đọc interaction qua `loadInteraction`, không inline script/style.
- Chỉ chấp nhận khi email trùng `REVIEW_LOGIN_EMAIL` **và** mật khẩu khớp. Mật khẩu luôn được kiểm, kể cả khi email sai, để thời gian trả lời không lộ email. Sai thì trả 401 với một thông báo chung "Email hoặc mật khẩu không đúng", không nói trường nào sai.
- Giới hạn lần sai (express-rate-limit, chỉ đếm trả lời ≥ 400): 5 lần mỗi IP trong 15 phút, 30 lần mỗi giờ cho mọi IP cộng lại.

### 4. Tài khoản

- Lần đầu thành công tạo tài khoản ở tenant chính (`AccountRepository.create`, nên có `tenantId`): username `app_review` (trùng thì thêm hậu tố ngẫu nhiên), tên "App Review", `emailVerifiedBy: null` (`email_verified` false: không provider nào xác minh), không liên kết provider, cờ `reviewLogin: true`.
- Mật khẩu chỉ mở tài khoản có cờ `reviewLogin`. Nếu email đã thuộc một tài khoản thường (ví dụ đặt nhầm email thật) thì từ chối và log cảnh báo: mật khẩu không bao giờ mở tài khoản của người thật.
- Phương thức này không được tính là cách đăng nhập khi huỷ liên kết provider (`usableSignInProviders` không đổi): nếu người duyệt liên kết thêm Google thì vẫn không gỡ được provider cuối cùng. Xoá tài khoản (ADR 0009) chạy như mọi tài khoản (không có liên kết Apple để thu hồi, `purgeAccountData` không cần thêm collection); lần đăng nhập duyệt sau tạo lại tài khoản mới.
- Hoàn tất qua `finishLogin` với `amr` `["pwd", "review"]`, nên `login.succeeded` có `methods: ["pwd", "review"]`.

### 5. Audit và log

- Lần sai ghi `login.failed` với `{ method: "review", reason: "unknown-email" | "wrong-password" }`: chỉ cho biết email có phải email đã cấu hình hay không, không bao giờ chứa email đã gõ hay mật khẩu. `sub` là tài khoản duyệt khi sai mật khẩu và tài khoản đã tồn tại, ngược lại là `review-login`.
- Log chỉ ghi lý do (`Review sign-in failed`), không email, không mật khẩu; logger vẫn redact `*.password`.

## Hệ quả

- Có lại một bề mặt đoán mật khẩu, giới hạn ở một tài khoản không có dữ liệu thật, có rate limit và chỉ mở trong thời gian duyệt.
- Localman nhận lại loại `login.failed` (đã có từ ADR 0003, ADR 0004 bỏ); handler của nó chỉ ghi lại.
- Bật/tắt theo `docs/deployment-guide.md`, mục "Đăng nhập cho người duyệt ứng dụng".
