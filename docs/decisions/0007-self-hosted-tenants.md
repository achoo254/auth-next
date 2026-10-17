# ADR 0007: Tenant tự host, hoandat chỉ là gateway khi setup

- Trạng thái: chấp nhận, chưa triển khai
- Ngày: 2026-10-17
- Phạm vi: lựa chọn "tự host" khi nhận domain, gói enrollment, trạng thái `self_hosted` trong sổ tenant, bản cài đóng gói của IdP, Localman, Tunelo và Chat, chuyển tenant đang chạy trên hoandat sang hạ tầng của họ (plan `plans/dattqh/261017-0735-self-hosted-tenant/`)
- Mở rộng ADR 0006; không thay quyết định nào của nó cho tenant chạy trên hoandat.

## Bối cảnh

Theo ADR 0006, mọi tenant chạy trên máy chủ của hoandat (.65): dữ liệu của IdP, Localman và Chat nằm chung database, tách bằng `tenantId`/`tenant_id`, backup chỉ nằm trên .65. Luồng nhận domain bắt các bản ghi A của `auth.`, `chat.`, `localman.`, `tunnel.` và hai wildcard trỏ về .65 hoặc Cloudflare, và lượt kiểm lại đình chỉ tenant nào trỏ đi nơi khác.

Có tenant muốn giữ dữ liệu và hạ tầng ở phía mình. Mục tiêu (user, 2026-10-17): hoandat chỉ làm gateway lúc setup (xác minh domain, xác nhận owner, cấp cấu hình ban đầu); setup xong thì mọi request, mọi lượt đăng nhập và mọi dữ liệu đi qua hạ tầng của tenant.

Sự thật đã kiểm quyết định hình dạng lời giải:

- Localman, Tunelo và Chat tra tenant, JWKS và discovery qua API nội bộ loopback của IdP trên **cùng máy**, không tin DNS công khai để lấy khoá. Chỉ tách app ra khỏi IdP thì phải bỏ ràng buộc đó.
- Code đã chạy được một domain bất kỳ làm tenant chính của bản cài riêng (`TENANT_DOMAIN`, `TENANT_DISPLAY_NAME`).
- Các tenant cô lập hoàn toàn: không tài khoản, phiên hay dữ liệu nào dùng chung, nên sau setup không có gì cần nối xuyên tenant.

## Quyết định

Jev (`jev-1.13.0`) quyết từng điểm với trạng thái là các sự thật trên; báo cáo `plans/dattqh/reports/architecture-261017-0723-self-hosted-tenant.md`.

### 1. Kiến trúc: bản cài tách rời

Jev 1,00. Các phương án bị loại: IdP ở lại hoandat còn app chạy ở tenant (0), code chạy trên .65 nối database của tenant (0), agent của tenant cùng proxy qua hoandat (0). Cả ba đều giữ hoandat trên đường đi của request hoặc dữ liệu.

Tenant tự host chạy **cả bộ** (IdP, Localman, Tunelo, Chat) trên máy của họ, domain của họ là **tenant chính** của bản cài đó. Ràng buộc loopback giữa app và IdP giữ nguyên. Sau khi chuyển, hoandat không nằm trên đường đi của request nào và không giữ dữ liệu người dùng nào của tenant.

### 2. Nhận domain ở chế độ tự host

- `/claim` (vẫn chỉ ở tenant chính) có lựa chọn chế độ: chạy trên hoandat (như ADR 0006) hoặc tự host. Chế độ ghi trong sổ tenant, không đổi được sau khi xác minh.
- Tự host chỉ cần TXT `_auth-claim.<d>` để xác minh sở hữu; **không** kiểm bản ghi A, không vào hàng đợi chứng chỉ, không dựng runtime. Owner là danh tính upstream của lượt nhận, như ADR 0006.
- Tenant tự host không tính vào `TENANT_MAX_ACTIVE` và không cần `CLAIM_MIN_AVAILABLE_MB`; vẫn tính vào `MAX_TENANTS_PER_ACCOUNT`.

### 3. Gói enrollment

- Xác minh xong, `/claim` cấp một gói enrollment: JWS ký bằng khoá ES256 của tenant chính (`primarySigningKey`), `aud` là `https://auth.<d>`, hạn ngắn, `jti` dùng một lần. Gói chứa domain, tên hiển thị và danh tính owner (provider và id upstream). Gói **không** chứa secret.
- Bản cài xác minh gói bằng JWKS của gateway. URL gateway là cấu hình của bản cài, không cố định trong code (CLAUDE.md: không nhúng URL của `hoandat.com` vào code chạy).
- Đổi gói là bước cuối của setup: bản cài đã chạy ở `https://auth.<d>` trên IP của tenant gửi gói về gateway; gateway kiểm `jti` chưa dùng, TXT còn đúng và `https://auth.<d>` trả lời thử thách của chính lượt đổi gói (chứng minh bản cài đang sống ở domain đó), rồi chuyển tenant sang `self_hosted`.
- Bản cài dùng danh tính owner trong gói để mở trang quản trị cho đúng người ở lần đăng nhập Google/GitHub đầu tiên; không có "người đến trước làm owner".

### 4. hoandat giữ gì sau khi chuyển

Jev 1,00 cho bản ghi tối thiểu (xoá hết: 0). Sổ tenant giữ domain, danh tính owner và trạng thái `self_hosted`. Không có dữ liệu người dùng hay secret nào của tenant. Lượt kiểm lại chỉ kiểm TXT để không ai nhận lại domain trên hoandat; TXT mất 3 lần liền thì bản ghi được gỡ và domain nhận lại được. `self_hosted` không phải trạng thái phục vụ: domain đó không có runtime trên hoandat.

### 5. Đóng gói

Jev 0,99 cho docker compose (script cài trên máy trần: 0,01). Một bundle compose gồm IdP, Localman, Tunelo, Chat, MongoDB (replica set một node), Postgres, nginx và certbot, image gắn phiên bản và ký. Wildcard `*.localman.<d>` và `*.tunnel.<d>` cần DNS-01, nên bundle dùng lại provisioner và token DNS do chính tenant giữ. Ba client chat (`chat-web`, `chat-mobile`, `chat-desktop`) giữ cùng client id, nên một bản app chat mobile/desktop vẫn phục vụ mọi tenant.

### 6. Cập nhật phiên bản

Jev 0,70 cho kênh phát hành có chữ ký (tải tay: 0,30). hoandat công bố bản phát hành đã ký; bản cài kéo về khi operator của tenant chọn. Không có traffic nào đi từ hoandat vào bản cài. Đây là quyết định có độ tin thấp nhất: xem lại sau khi có tenant tự host đầu tiên.

### 7. Chuyển tenant đang chạy trên hoandat

- Jev 0,98 cho export/import (chỉ cho tenant mới: 0,02). Export theo tenant ở cả ba app: mọi document/hàng có `tenantId` của tenant, cùng secret của tenant được **niêm phong lại** cho khoá công khai mà bản cài sinh ra lúc enrollment (cùng cách IdP niêm phong token DNS cho provisioner). Import trên bản cài mới, rồi đổi bản ghi A và chuyển `self_hosted`.
- Jev 0,88 cho chuyển khoá ký cũ (sinh khoá mới: 0,12), để token đã cấp và JWKS mà các app đang cache vẫn hợp lệ qua lúc chuyển. Khoá truyền niêm phong, đúng một lần; bản trên .65 bị huỷ khi tenant chuyển xong.
- Backup cả ba database trên .65 trước khi export. Dữ liệu và secret của tenant trên .65 bị xoá sau 14 ngày (bằng vòng xoay backup), để còn đường lùi.

## Hệ quả

- Sau khi chuyển, hoandat không backup, không vá bảo mật và không vận hành thay tenant. Trang claim phải nói rõ điều này trước khi tenant chọn tự host.
- Phải duy trì bundle và kênh phát hành: Dockerfile cho bốn app, ký image, ghi chú nâng cấp và migration theo phiên bản.
- Mã nhận domain có thêm một nhánh. Test giữ: tenant `self_hosted` không bao giờ có runtime, chứng chỉ hay block nginx trên hoandat, và không bao giờ bị kiểm bản ghi A.
- ADR 0004 vẫn áp dụng cho bản cài: chỉ đăng nhập bằng Google/GitHub, không mật khẩu, không gửi email.
- Đường lùi trước khi đổi bản ghi A: tenant vẫn chạy trên hoandat như cũ. Sau khi chuyển: tenant tự vận hành; quay lại hoandat là một lượt chuyển ngược (export từ bản cài, import vào .65), chưa có trong plan này.
