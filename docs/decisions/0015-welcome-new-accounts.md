# ADR 0015: Màn chào mừng cho tài khoản mới

- Trạng thái: chấp nhận
- Ngày: 2026-10-31
- Phạm vi: `src/interactions/welcome-routes.ts`, `src/interactions/welcome-page.ts`, `static/css/welcome.css`; gọi từ bước chọn username (`upstream-finish-routes.ts`).
- Liên quan: ADR 0004, 0008 (chỉ đăng nhập qua Google/GitHub/Apple), ADR 0011 (`client_usage`), ADR 0014 (mục tiêu 500 tài khoản, 100 người dùng thường xuyên).

## Bối cảnh

Mục tiêu tới 31/12/2026 là 500 tài khoản và 100 người dùng thường xuyên trên cả hệ sinh thái. Người đăng ký từ một
app thường chỉ biết app đó. Jev chọn (0,77): ngay khi tài khoản được tạo trong lần đăng nhập này, hiện một màn chào
mừng giới thiệu ba app chủ lực (Tử Vi, Miu World, Web Nhanh), rồi một nút "Tiếp tục vào <app>" hoàn tất đăng nhập như
cũ. Tài khoản đã có không bao giờ thấy màn này.

## Quyết định

1. "Tài khoản mới" chỉ được biết ở một chỗ: route chọn username vừa `accounts.create` thành công. Không suy từ
   `createdAt` hay dữ liệu trình duyệt gửi lên.
2. Lần đăng nhập đang chờ được giữ phía server trong `one_time_tokens` (loại `welcome-pending`, khoá theo uid của
   interaction, sống 30 phút như interaction, chứa `accountId` và `amr`). Chỉ trình duyệt có cookie của interaction
   tới được `/interaction/:uid/welcome` (`loadInteraction`). Xoá tài khoản xoá luôn token này (`purgeAccountData` lọc theo `data.accountId`), và `finishLogin` vẫn đọc lại tài khoản.
3. Nút "Tiếp tục" là POST có CSRF (`csrfScope(uid)`), lấy token ra một lần rồi gọi `finishLogin` (ghi
   `login.succeeded`, đọc lại tài khoản). Không có đường đăng nhập mới; trước khi bấm, chưa có phiên nào.
4. Bỏ qua màn này, hoàn tất ngay như trước, khi tenant chưa cấu hình app chủ lực nào, hoặc khi đăng nhập từ app điện
   thoại của chính hệ (client tĩnh `native`, không phải device flow): ở đó trang chạy trong khung đăng nhập của app,
   link sang app khác sẽ làm mất lần đăng nhập. App bên ngoài (DCR) và trang `/account` thấy nút trung tính "Tiếp tục"
   (tên do app tự khai không được IdP đứng tên).
5. Link app mở tab mới (`target="_blank" rel="noopener noreferrer"`); địa chỉ lấy từ `Tenant.webApps`, không cố định.

## Hệ quả

- App tích hợp không phải đổi gì: sau màn chào mừng IdP vẫn quay về `redirect_uri` với `code` như mọi lần.
- Thêm app chủ lực khác hay đổi thứ tự là sửa `HERO_APPS` trong `welcome-page.ts` và chuỗi `welcome.benefit.*`.
