# 0018. Xoá tài khoản chỉ ở IdP, mọi app dọn theo

Ngày: 2026-11-13. Trạng thái: chấp nhận. Bổ sung ADR 0009 (mục 3, "Dữ liệu trong các app khác").

## Bối cảnh

Mỗi app từng có luồng xoá riêng (Chat giữ 30 ngày và bắt chuyển chủ nhóm, Localman chặn khi còn workspace dùng chung, kb, Miu, Scribe mỗi app một kiểu), còn xoá ở IdP thì không app nào biết nên dữ liệu ở app nằm lại. Chủ sở hữu chốt (13/11): xoá tài khoản chỉ ở `auth.hoandat.com/account`; app không có nút, màn hay API xoá; tài sản dùng chung tự chuyển chủ; xoá ngay, không giữ.

## Quyết định

### IdP gửi
- Sau bước 7 của ADR 0009, IdP tạo một bản giao cho mỗi URL nhận khai trong env `ACCOUNT_DELETED_URLS` (danh sách URL https, cách nhau bằng dấu phẩy) và giao từ outbox riêng, thử lại với backoff (5 giây nhân đôi, tối đa 1 giờ giữa hai lần) tới khi nhận 2xx. Không giới hạn số lần thử.
- Request: `POST <URL>`, `Content-Type: application/secevent+jwt`, body là một SET (RFC 8417) ký ES256 bằng khoá chính của IdP, như audit (ADR 0003):
  - header `alg: ES256`, `kid`, `typ: secevent+jwt`;
  - claim `iss` (issuer IdP), `aud` (đúng URL nhận), `sub` (mã tài khoản đã xoá), `jti` (cố định cho mỗi bản giao, dùng lại khi thử lại), `iat`, `exp` (`iat` + 600), `toe` (lúc xoá);
  - `events`: `{"urn:hoandat:auth:event:account.deleted": {}}`.
- Không Basic, không secret chung: chữ ký và `aud` là đủ. Không có dữ liệu cá nhân nào khác trong SET.

### App nhận
- Kiểm SET bằng JWKS từ discovery của IdP: `alg` ES256, `typ` `secevent+jwt`, `iss`, `aud` đúng URL của mình, chưa hết hạn, có đúng event trên.
- Xoá mọi dữ liệu của người dùng mang `sub` đó, **bền và idempotent**: trả 2xx (khuyên `202`) chỉ khi đã xoá xong hoặc đã ghi việc xoá vào hàng đợi bền của app. `sub` không có trong app cũng trả 2xx. Chữ ký sai, `aud` sai, hết hạn trả `401`, để IdP thử lại khi cấu hình sai được sửa.
- Tài sản dùng chung mà người bị xoá làm chủ (nhóm, kênh, workspace, project có người khác): chuyển chủ cho người còn lại có vai trò cao nhất, cùng vai trò thì người tham gia sớm nhất; không còn ai thì xoá. Nội dung người đó đã gửi vào chỗ chung xử lý như luồng xoá sẵn có của app (ví dụ Chat hiện "Tài khoản đã xoá").
- Không log SET, `sub` cùng nội dung; chỉ log id nội bộ và kết quả.
- Ngay sau khi nhận, đăng nhập lại bằng `sub` đó phải bị từ chối (IdP không bao giờ cấp lại `sub` cũ, ADR 0009 mục 1).

### Giao diện
- Không app nào còn nút, màn, hộp thoại hay API xoá tài khoản (kể cả "tự xoá khi không dùng"). Chỗ cũ, nếu cần, chỉ còn một dòng dẫn tới `https://auth.hoandat.com/account#account-delete`.
- Trang xác nhận xoá của IdP nói rõ: dữ liệu trong mọi app của hệ sinh thái bị xoá theo; nhóm và workspace dùng chung chuyển cho người khác.

## Hệ quả
- Thêm app mới thì phải có endpoint nhận và thêm URL vào `ACCOUNT_DELETED_URLS`; thiếu thì dữ liệu app đó nằm lại (như trước ADR này).
- App ngừng chạy lâu thì bản giao nằm chờ trong outbox của IdP; không mất.
- Mất đường lùi 30 ngày của Chat: đây là lựa chọn có chủ ý (một luật cho mọi app).
