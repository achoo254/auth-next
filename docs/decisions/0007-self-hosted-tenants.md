# ADR 0007: Tenant tự host, hoandat chỉ là gateway khi setup

- Trạng thái: chấp nhận, đã triển khai: bật trên production 17/10/2026, nghiệm thu 19/10/2026 (chuyển trọn `hoandat.io.vn` sang VM công khai, bản phát hành 0.3.2)
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

- `/claim` (vẫn chỉ ở tenant chính) có lựa chọn chế độ khi bật `SELF_HOSTED_CLAIMS`: chạy trên hoandat (như ADR 0006) hoặc tự host. Lượt nhận mang chế độ; trong sổ tenant chế độ suy từ trạng thái (`enrolling`, `self_hosted` chỉ có ở tenant tự host), không đổi được sau khi xác minh.
- Tự host chỉ cần TXT `_auth-claim.<d>` để xác minh sở hữu; **không** kiểm bản ghi A, không vào hàng đợi chứng chỉ, không dựng runtime. Owner là danh tính upstream của lượt nhận, như ADR 0006.
- Tenant tự host không tính vào `TENANT_MAX_ACTIVE` và không cần `CLAIM_MIN_AVAILABLE_MB`; vẫn tính vào `MAX_TENANTS_PER_ACCOUNT`.

### 3. Gói enrollment

- Owner tải gói từ `/claim` khi tenant `enrolling` (POST có CSRF, cần đăng nhập gần đây). Gói là JWT ký bằng khoá ES256 của tenant chính (`primarySigningKey`), `typ` `hoandat-enrollment+jwt`, `aud` là `https://auth.<d>`, `sub` là id tenant, hạn 24 giờ, `jti` ngẫu nhiên. Gói chứa domain, tên hiển thị và danh tính owner (provider và id upstream). Gói **không** chứa secret.
- Gói dùng một lần mà không lưu `jti`: đổi gói là phép ghi có điều kiện `enrolling` → `self_hosted`, nên sau lần đầu mọi gói của tenant đó đều hết dùng được. Owner tải lại được gói khác khi tenant còn `enrolling`.
- Bản cài đặt `ENROLLMENT_GATEWAY` (issuer của gateway, cấu hình, không cố định trong code), `ENROLLMENT_BUNDLE_PATH`, `ENROLLMENT_KEY_PATH` (khoá ES256 của bản cài, tự sinh lần đầu, mode 600). Lúc khởi động bản cài kiểm gói bằng JWKS của gateway, đúng `aud` là `ISSUER` và đúng domain là `TENANT_DOMAIN`; sai thì không khởi động.
- Đổi gói là bước cuối của setup: bản cài đã chạy ở `https://auth.<d>` gửi gói và khoá công khai của nó tới `POST /claim/enrollments` của gateway (JSON, không cookie). Gateway kiểm gói, tenant còn `enrolling`, TXT còn đúng, rồi gọi `https://auth.<d>/.well-known/hoandat-enrollment?nonce=<n>`; bản cài trả về nonce ký bằng chính khoá vừa gửi. Đạt thì tenant `self_hosted`, gateway lưu khoá công khai (thumbprint RFC 7638) và ghi audit `tenant.self_hosted`. Cùng bản cài đổi lại (cùng khoá) vẫn thành công; khoá khác bị từ chối.
- Lượt gọi thử thách đi tới host do người khác kiểm soát: chỉ HTTPS có chứng chỉ hợp lệ, chỉ địa chỉ công khai (kiểm ngay lúc kết nối để chống DNS rebinding), không theo redirect, 10 giây, tối đa 16 KiB.
- Bản cài **không** có trang quản trị như `/admin` của tenant sổ: domain là tenant chính của bản cài, cấu hình bằng `.env` như hoandat.com, và người giữ máy là người vận hành. Danh tính owner trong gói được ghi lại cho các bước sau (phase 05), không dùng để mở trang nào.

### 4. hoandat giữ gì sau khi chuyển

Jev 1,00 cho bản ghi tối thiểu (xoá hết: 0). Sổ tenant giữ domain, danh tính owner và trạng thái `self_hosted`. Không có dữ liệu người dùng hay secret nào của tenant. Lượt kiểm lại chỉ kiểm TXT để không ai nhận lại domain trên hoandat; TXT mất 3 lần liền thì bản ghi được gỡ và domain nhận lại được. `self_hosted` không phải trạng thái phục vụ: domain đó không có runtime trên hoandat.

### 5. Đóng gói

Jev 0,99 cho docker compose (script cài trên máy trần: 0,01). Bundle `deploy/self-hosted/` (hướng dẫn: `docs/self-hosted-install.md`) gồm IdP, Localman, Tunelo, Chat, MongoDB (replica set một node), Postgres, nginx và certbot. Ba client chat (`chat-web`, `chat-mobile`, `chat-desktop`) giữ cùng client id, nên một bản app chat mobile/desktop vẫn phục vụ mọi tenant.

- **Một host như máy chủ dùng chung:** các container app dùng chung network namespace với nginx và nghe trên `127.0.0.1`. Vì vậy cấu hình nginx là chính các block tenant của ba repo (chỉ bỏ listener IPv6, điền hash CSP, mở `/internal/` của Localman cho loopback để nhận audit), và mỗi app vẫn chỉ tin địa chỉ chuyển tiếp từ loopback (Chat chỉ tin `X-Real-IP` từ loopback). Luật real-IP Cloudflare đặt ở cấp http như trên máy chủ dùng chung; thiếu nó, một request Flexible tới block Localman sẽ mang địa chỉ `127.0.0.1`.
- **Không có API nội bộ:** domain là tenant chính, nên Localman và Tunelo không cần `IDP_INTERNAL_*`; tenant chính được cấu hình bằng env.
- **Chứng chỉ:** certbot `dns-cloudflare` cấp thẳng một chứng chỉ cho mọi host (kể cả hai wildcard) bằng token DNS của tenant, thay vì dùng lại provisioner: bản cài chỉ có một domain, nên hàng đợi của provisioner không cần. Map `$tenant_cert` có sẵn tìm chứng chỉ theo tên `<d>` và `wildcard.<d>` (một symlink).
- **Enrollment chỉ một lần:** đổi gói xong, IdP ghi `<ENROLLMENT_KEY_PATH>.enrolled`; các lần khởi động sau bỏ qua enrollment, nên gói hết hạn không làm IdP dừng và gateway không ở trên đường khởi động.
- Web của Localman (`VITE_IDP_ORIGIN`) và Chat (`brand.config.json`) nhúng domain lúc build: image build theo domain, từ mã nguồn (ký image là phase 04).

### 6. Cập nhật phiên bản

Jev 0,70 cho kênh phát hành có chữ ký (tải tay: 0,30). hoandat công bố bản phát hành đã ký; bản cài kéo về khi operator của tenant chọn. Không có traffic nào đi từ hoandat vào bản cài.

Chi tiết (user chọn 17/10/2026, Jev tư vấn):

- **Image dựng sẵn trên GHCR, ký cosign keyless** (Jev 0,91; tarball mã nguồn 0,09): workflow `.github/workflows/selfhosted-release.yml` chạy tay với phiên bản và commit của localman-next, chat-next; đẩy sáu image `selfhosted-{auth,localman,tunelo,chat,nginx,bundle}:<x.y.z>` (`linux/amd64`, private như các repo) và ký từng digest. Danh tính ký là chính workflow đó; `update.sh` kiểm danh tính này. Image dùng chung mọi domain: web của Localman đọc tenant qua `GET /api/v1/tenant`, web của Chat đọc từ `chat.<domain>` (localman-next không phải sửa, chat-next `3236784`), nginx gửi mọi `chat.<domain>` về tenant duy nhất. Image `selfhosted-bundle` mang file của bundle cùng phiên bản. Không có manifest riêng: một phiên bản là cùng một tag trên sáu image, mỗi image ký theo digest.
- **Image công khai trên GHCR** (user chọn 17/10/2026, cùng lúc chuyển các repo sang public; thay cho quyết định trước đó là tải qua gateway bằng token riêng từng tenant, đã gỡ khỏi code): ai cũng kéo được image `selfhosted-*`, nên gateway không nằm trên đường cập nhật. Nguồn gốc và toàn vẹn chỉ dựa vào chữ ký cosign: `update.sh` từ chối image không được workflow phát hành ký. GHCR không cho chuyển package public về lại private. Dockerfile của bundle không bao giờ nhận secret (build-arg, ENV, COPY).
- **Cập nhật:** `update.sh` của bản cài lấy danh sách phiên bản và digest của từng image từ GHCR (token ẩn danh của GHCR cho image công khai), kiểm chữ ký cosign trên chính digest đó, lấy file bundle của phiên bản, backup MongoDB và Postgres, chạy `compose.release.yaml` theo digest, rồi lùi về phiên bản (hoặc bản build tại chỗ) trước nếu stack không lên.

### 7. Chuyển tenant đang chạy trên hoandat

- Jev 0,98 cho export/import (chỉ cho tenant mới: 0,02). Export theo tenant ở cả ba app: mọi document/hàng có `tenantId` của tenant, cùng secret của tenant được **niêm phong lại** cho khoá công khai mà bản cài sinh ra lúc enrollment (cùng cách IdP niêm phong token DNS cho provisioner). Import trên bản cài mới, rồi đổi bản ghi A và chuyển `self_hosted`.
- Jev 0,88 cho chuyển khoá ký cũ (sinh khoá mới: 0,12), để token đã cấp và JWKS mà các app đang cache vẫn hợp lệ qua lúc chuyển. Khoá truyền niêm phong, đúng một lần; bản trên .65 bị huỷ khi tenant chuyển xong.
- Backup cả ba database trên .65 trước khi export. Dữ liệu và secret của tenant trên .65 bị xoá sau 14 ngày (bằng vòng xoay backup), để còn đường lùi.
- Cách làm (17/10/2026, user chọn chuyển trọn ba repo; Jev 0,41): owner bấm **Chuyển sang máy chủ của bạn** ở `/claim` (tenant `active` → `migrating`: thôi phục vụ ở đây ngay, dữ liệu giữ nguyên cho export, không bị kiểm TXT/A trong lúc chuyển, huỷ được và phục vụ lại ngay), tải gói enrollment và cài như tenant mới. `init.sh` sinh thêm khoá chuyển của bản cài (`data/secrets/migration-key.json`, ECDH-ES P-256, tách khỏi khoá enrollment ES256). Operator chạy `deploy/self-hosted/migrate/export-tenant.sh` trên .65 với khoá công khai đó, gửi thư mục kết quả sang bản cài qua SSH, owner chạy `migrate/import-tenant.sh`, rồi trỏ bản ghi A; bản cài đổi gói và tenant thành `self_hosted`.
- Secret không bao giờ rời .65 dạng rõ: IdP niêm phong khoá ký, OAuth app, bot và `SESSION_KEY` của Chat thành JWE cho khoá chuyển (token DNS không đi, chỉ provisioner mở được). Keyring biến của Localman dùng chung mọi tenant nên không đi: giá trị bí mật được niêm phong lại bằng một khoá tạo riêng cho lượt chuyển, khoá này niêm phong cho khoá chuyển, rồi bản cài niêm phong lại bằng keyring của mình. Secret webhook bot của Chat mở ở bản cài bằng `SESSION_KEY` cũ làm khoá trước (`-role reseal`).
- Dữ liệu chuyển: mọi document `tenantId` của IdP (mongodump) và Tunelo (API key, lượt dùng), mọi document của Localman trừ phiên, khoá, hàng đợi, rate limit, magic link và token MCP; hàng Chat của tenant (bảng có `tenant_id` và bảng tới được qua chat, user, bot, hook), trừ phiên, push, outbox và các log đồng bộ (`server_epoch` tăng nên client đồng bộ lại). Tenant đổi id sang `primary` của bản cài; id tài khoản, user, chat và `kid` khoá ký giữ nguyên, nên token và phiên IdP còn hiệu lực. Không có media: tenant ngoài tenant chính trên .65 chạy chat không media.
- Xoá trên .65: `migrate/purge-tenant.sh` chỉ chạy khi IdP đã thấy tenant `self_hosted` đủ 14 ngày; đếm trước, `--confirm` mới xoá, khoá ký của tenant xoá cuối.

## Hệ quả

- Sau khi chuyển, hoandat không backup, không vá bảo mật và không vận hành thay tenant. Trang claim phải nói rõ điều này trước khi tenant chọn tự host.
- Phải duy trì bundle và kênh phát hành: Dockerfile cho bốn app, ký image, ghi chú nâng cấp và migration theo phiên bản.
- Mã nhận domain có thêm một nhánh. Test giữ: tenant `self_hosted` không bao giờ có runtime, chứng chỉ hay block nginx trên hoandat, và không bao giờ bị kiểm bản ghi A.
- ADR 0004 vẫn áp dụng cho bản cài: chỉ đăng nhập bằng Google/GitHub, không mật khẩu, không gửi email.
- Đường lùi trước khi đổi bản ghi A: huỷ chuyển ở `/claim`, tenant chạy lại trên hoandat như cũ (trong lúc `migrating` nó không được phục vụ ở đâu cả). Sau khi chuyển: tenant tự vận hành; quay lại hoandat là một lượt chuyển ngược (export từ bản cài, import vào .65), chưa có trong plan này.
