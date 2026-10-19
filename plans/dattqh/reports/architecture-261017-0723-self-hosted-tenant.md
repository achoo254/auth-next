# Đề xuất: tenant tự host (hoandat chỉ là gateway khi setup)

Ngày 17/10/2026. Trạng thái: đề xuất, chờ user duyệt rồi mới viết ADR 0007 và plan.

## Mục tiêu

Thêm một lựa chọn cho tenant: dữ liệu và hạ tầng nằm ở phía tenant. hoandat.com chỉ làm gateway lúc
setup (xác minh domain, xác nhận owner, cấp cấu hình ban đầu). Setup xong thì mọi request, mọi lượt
đăng nhập và mọi dữ liệu đi qua hạ tầng của tenant; hoandat không nằm trên đường đi của request nào.

## Sự thật đã kiểm (đầu vào cho Jev)

- Mọi tenant hiện chạy trên .65. Dữ liệu tách bằng `tenantId` (IdP, Localman) và `tenant_id` (Chat),
  backup chỉ nằm trên .65 (ADR 0006, ADR 0003 của localman-next, ADR 0010 của chat-next).
- Lúc nhận domain, các bản ghi A phải trỏ về IP của .65 hoặc qua Cloudflare. Lượt kiểm lại mỗi giờ
  đình chỉ tenant sau 3 lần sai, nên hôm nay trỏ DNS sang nơi khác sẽ dẫn tới bị đình chỉ.
- Localman, Tunelo, Chat tra tenant, JWKS, discovery qua API nội bộ loopback của IdP trên cùng máy.
  Vì vậy app luôn đi kèm một IdP trên cùng host.
- Code đã chạy được một domain bất kỳ làm tenant chính của bản cài riêng (`TENANT_DOMAIN`,
  `TENANT_DISPLAY_NAME`).
- Các tenant cô lập hoàn toàn, nên sau setup không có gì cần liên kết xuyên tenant.

## Quyết định của Jev (`jev-1.13.0`)

| Câu hỏi | Jev chọn | Xác suất |
|---|---|---|
| Kiến trúc | **Bản cài tách rời** (detached install) | 1,00; control plane ở hoandat 0; BYO database 0; agent + proxy 0 |
| Đóng gói | **Docker compose** có image ký, gắn phiên bản | 0,99; script cài trên máy trần 0,01 |
| Tenant đang chạy trên hoandat muốn chuyển | **Export/import** theo tenant, có cửa sổ chuyển | 0,98; chỉ cho tenant mới 0,02 |
| Khoá ký khi chuyển | **Chuyển khoá cũ sang** | 0,88; sinh khoá mới 0,12 |
| hoandat giữ gì sau khi chuyển | **Bản ghi tối thiểu** (domain, owner, trạng thái `self-hosted`, kiểm TXT) | 1,00; xoá hết 0 |
| Cập nhật phiên bản | **Kênh phát hành có chữ ký**, tenant tự kéo về | 0,70; tải tay 0,30 |

Câu "Cập nhật" có xác suất thấp nhất (0,70). Đây là chỗ nên cân nhắc lại khi viết ADR.

## Kiến trúc đề xuất

### Vai trò của hoandat (chỉ lúc setup)

1. `/claim` có thêm lựa chọn "Tự host". Bước xác minh chỉ cần TXT `_auth-claim.<d>` (bằng chứng sở hữu),
   **không** bắt bản ghi A trỏ về .65.
2. Xác minh xong, hoandat cấp **gói enrollment** dùng một lần, có chữ ký, có hạn. Gói chứa domain,
   danh tính owner, tên hiển thị và cấu hình OAuth (không chứa secret dạng rõ).
3. Bản cài của tenant đổi gói enrollment; hoandat ghi tenant ở trạng thái `self-hosted`.
4. Từ đó hoandat không tạo runtime, chứng chỉ hay block nginx cho domain này. Lượt kiểm lại mỗi giờ
   chỉ kiểm TXT, để không ai nhận lại domain trên hoandat.

### Bản cài của tenant

- Một bundle docker compose gồm IdP, Localman, Tunelo, Chat, MongoDB, Postgres, nginx và certbot. Domain
  của tenant là **tenant chính** của bản cài này, nên giữ nguyên được ràng buộc loopback giữa app và IdP.
- Ba client chat (`chat-web`, `chat-mobile`, `chat-desktop`) có sẵn với cùng client id, nên app chat
  mobile/desktop đăng nhập ở `https://auth.<d>` như mọi tenant khác.
- Image ký và gắn phiên bản; tenant kéo bản mới từ kênh phát hành khi tự chọn. Không có traffic nào
  đi từ hoandat vào bản cài của tenant.

### Chuyển tenant đang chạy trên hoandat

1. Backup database `auth`, Localman, Chat trên .65.
2. Export theo tenant: mọi document/hàng có `tenantId` của tenant, cùng secret niêm phong lại cho bản cài
   mới (có khoá ký, để token đã cấp và JWKS mà app đang cache vẫn hợp lệ qua lúc chuyển).
3. Import vào bản cài mới, đổi bản ghi A sang IP của tenant, đánh dấu `self-hosted`.
4. Xoá dữ liệu và secret của tenant trên .65 sau một thời hạn giữ lại có kiểm soát.

## Việc phải làm (ước lượng L–XL, chạm ba repo)

- **hoandat-auth**: thêm trạng thái `self-hosted`; luồng nhận chỉ bằng TXT; gói enrollment và endpoint
  đổi gói; lượt kiểm lại chỉ TXT; export/import theo tenant; ADR 0007.
- **Đóng gói**: Dockerfile cho IdP, Localman, Tunelo, Chat; compose; ký image; kênh phát hành.
- **localman-next, chat-next**: export/import theo tenant cho dữ liệu của mỗi app; chạy được trong compose.
- **Tài liệu**: hướng dẫn cài đặt cho tenant; cập nhật trang `/guide/domain`.

## Rủi ro và điểm cần chú ý

- Chuyển khoá ký ra khỏi .65 nghĩa là khoá rời hạ tầng của hoandat: phải truyền niêm phong, một lần,
  rồi huỷ bản trên .65.
- Sau khi chuyển, hoandat không backup, không vá bảo mật thay tenant. Trang claim phải nói rõ điều này.
- Kênh phát hành là phần việc lâu dài (ký, lưu trữ bản phát hành, hướng dẫn nâng cấp và migration).

## Câu hỏi còn mở cho user

1. Có khách cụ thể nào cần ngay không (ví dụ `inetdev.io.vn`)? Nếu không, có thể làm trước luồng cho
   tenant mới, rồi export/import sau.
2. Có cần đủ cả bốn app trong bundle không, hay giai đoạn đầu chỉ cần IdP + Localman?
3. Cập nhật qua kênh phát hành (Jev 0,70) hay tải tay giai đoạn đầu cho nhẹ việc?
