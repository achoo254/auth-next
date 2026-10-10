# ADR 0004: Chỉ đăng nhập và đăng ký bằng Google hoặc GitHub

- Trạng thái: chấp nhận
- Ngày: 2026-10-10
- Phạm vi: trang đăng nhập/đăng ký, `/account`, tầng tài khoản và audit của IdP; thay một phần ADR 0002 (mục 3, 4, 8, 10) và ADR 0003 (danh sách sự kiện ở mục 3)

## Bối cảnh

ADR 0002 cho phép đăng nhập bằng email/username và mật khẩu, kèm cả một hệ thống quanh mật khẩu: mã khôi phục, quên mật khẩu qua mã khôi phục, link Telegram hoặc Google/GitHub, khoá đăng nhập và cookie thiết bị, và trang rà soát bảo mật bắt buộc sau mỗi lần đặt lại. Google và GitHub đã chạy ở production.

Chủ sản phẩm yêu cầu chỉ còn Google và GitHub. Jev (2026-10-09, 0.94) chọn bỏ hẳn ("remove_fully") thay vì chỉ ẩn form: code, route và test của mật khẩu đều bị xoá, để không còn bề mặt tấn công hay đường vào nào phải bảo trì mà không ai dùng.

## Quyết định

### 1. Google/GitHub là cách duy nhất để vào

- Trang đăng nhập (`/interaction/:uid`) chỉ có "Đăng nhập với Google", "Đăng nhập với GitHub" và nút huỷ. `prompt=create` vẫn mở trang đăng ký, với đúng hai nút đó ("Đăng ký với …") và link "Đã có tài khoản? Đăng nhập".
- Danh tính Google/GitHub chưa liên kết với tài khoản nào đi theo luật liên kết sẵn có (ADR 0002 mục 9): email trùng tài khoản có email đã xác minh thì tự liên kết; không thì chọn username và tạo tài khoản mới (`upstream-finish-routes.ts`), email lấy từ provider nên luôn đã xác minh. Không cần luồng tạo tài khoản mới.
- Chưa cấu hình Google lẫn GitHub thì trang đăng nhập và đăng ký trả 503 với thông báo, thay cho một trang trống.
- Route mật khẩu bị xoá, không chỉ ẩn: `POST /interaction/:uid/login`, `/signup`, `/signup/done`, `/forgot*`, `/review*`, `/reset/*`, `POST /account/password`, `/account/recovery-codes*` đều rơi xuống routing bình thường và trả 404. `GET /interaction/:uid/login` còn lại cho link "Đã có tài khoản? Đăng nhập".
- Module bị xoá: `password-hasher`, `recovery-codes`, `login-throttle`, `throttle-policy`, cookie thiết bị (`device-cookie`), `reset-link-service`, `after-password-change`, `record-login`, mọi trang/route quên mật khẩu, đặt lại và rà soát; dependency `@node-rs/argon2`. `completeLogin` (chỉ tồn tại để chặn ở trang rà soát) nhập vào `finishLogin`.

### 2. Dữ liệu cũ để nguyên, không bao giờ đọc

- Không migration và không ghi vào database: `passwordHash`, `recoveryCodeHashes`, `recoveryCodesCreatedAt`, `credentialsChangedAt`, `securityReviewPendingSince` của tài khoản cũ vẫn nằm trong MongoDB.
- Các trường đó bị gỡ khỏi kiểu `AccountDocument`, nên TypeScript không cho code nào đọc chúng. Cờ rà soát cũ không còn chặn đăng nhập, `/account` hay token exchange (không còn luồng nào xoá được nó). Collection `login_throttle` không còn được dùng; tài liệu trong đó tự hết hạn theo TTL.

### 3. Không tự khoá mình ngoài tài khoản

- Không huỷ liên kết được provider cuối cùng còn đăng nhập được: route `/account/unlink/:provider` đòi một provider khác đã liên kết **và** đang bật ở IdP (`usableSignInProviders`); lệnh ghi ở `AccountLinks.unlinkProvider` đòi provider kia vẫn liên kết (trước đây mật khẩu cũng được tính), nên hai lần huỷ song song không để tài khoản trống.
- Mục "Cách đăng nhập" ở `/account` có neo `#account-sign-in` (thay `#account-password`; `#account-recovery` bỏ hẳn) và khuyên liên kết cả hai provider.
- Telegram vẫn liên kết được nhưng chỉ để nhận thông báo; không còn link đặt lại mật khẩu.

### 4. Audit

- Không còn phát: `login.failed`, `login.locked`, `password.changed`, `password.reset`, `recovery_codes.regenerated`; `cause` của `session.revoked`/`grant.revoked` chỉ còn `account-page`, `token-revocation`. Các kiểu này bị xoá khỏi `src/audit/audit-events.ts`.
- Hợp đồng với Localman (`/internal/audit-events`, SET) không đổi. Handler của Localman chỉ hành động trên `email.reclaimed`, `method.linked`, `method.unlinked` (Telegram) và chỉ ghi lại các loại khác, nên không có gì bên đó hỏng. Sự kiện cũ thuộc các loại đã bỏ mà còn nằm trong outbox vẫn được gửi nguyên trạng.

## Hệ quả

- Tài khoản cũ có mật khẩu mà **không** liên kết Google/GitHub nào thì không đăng nhập được nữa. Nếu người đó đăng nhập bằng Google/GitHub có email trùng email (chưa xác minh) của tài khoản cũ, luật lấy lại email (ADR 0002 mục 9) tạo một tài khoản **mới** với `sub` mới, tài khoản cũ mất email; dữ liệu Localman gắn với `sub` cũ không tự sang tài khoản mới. Luật này giữ nguyên vì tự liên kết vào email chưa xác minh mở lại lỗ chiếm tài khoản trước.
- Khôi phục tài khoản giờ dựa vào provider thứ hai đã liên kết: mất quyền vào tài khoản Google/GitHub duy nhất là mất tài khoản hoandat, trừ khi quản trị viên can thiệp trực tiếp.
- Ít bề mặt hơn: không còn đoán mật khẩu, khoá tài khoản, link reset trong URL hay trang rà soát. Error handler và nginx vẫn che path `/reset/...` cho link cũ còn nằm trong chat Telegram.
- Thao tác nhạy cảm ở `/account` vẫn cần đăng nhập trong 10 phút; đăng nhập lại là qua Google/GitHub (`prompt=login`).
- Localman phải đổi link `#account-password` sang `#account-sign-in` và bỏ mục "Mã khôi phục" (`#account-recovery`).
