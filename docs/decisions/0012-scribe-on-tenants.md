# ADR 0012: Scribe trên tenant sổ, key AI do owner nhập và niêm phong cho Scribe

- Trạng thái: **superseded** (24/10/2026) bởi [ADR 0013](0013-single-tenant.md). Phần dưới là lịch sử, không còn mô tả code hiện tại. Trạng thái trước đó: chấp nhận
- Ngày: 2026-10-24
- Phạm vi: trang `/admin` của tenant sổ (mục Scribe), `tenant_secrets` (loại `scribe-*`), API nội bộ cho role `scribe`, client `scribe-web` của tenant sổ, chứng chỉ `scribe.<d>`. Mở rộng ADR 0006; không đổi gì của tenant chính, app di động hay bundle tự host (ADR 0007).

> **Superseded.** Scribe chỉ chạy cho `hoandat.com` với client từ env; không còn key AI của tenant, niêm phong cho Scribe, vai `scribe` của API nội bộ, `scribe-web` của tenant sổ hay chứng chỉ `scribe.<d>`.

## Bối cảnh

Scribe (`scribe-next`, chép lời, biên bản, hỏi đáp, dịch) chỉ chạy cho tenant chính `hoandat.com` và trả tiền AI bằng key của người vận hành. Mục tiêu (24/10/2026): người dùng của mọi tenant đang phục vụ dùng Scribe web ở `https://scribe.<domain>`, đăng nhập bằng IdP của domain đó; tiền AI của domain do chủ domain trả. Jev chốt (user uỷ quyền): Scribe chỉ bật trên một tenant sau khi owner nhập ít nhất một key chép lời ở `/admin`; key niêm phong cho Scribe (IdP ghi được, không đọc lại được, không API nào trả bản rõ); chỉ web; bundle tự host không có Scribe; mọi phần mới nằm sau một cờ tắt mặc định.

## Quyết định

### 1. Bật và tắt

- `SCRIBE_TENANTS` (mặc định tắt, nhận `true`/`1`) và `SCRIBE_SEALING_PUBLIC_KEY_PATH` (PEM public key RSA ≥ 3072 bit của Scribe, đọc và kiểm lúc khởi động; tệp chứa private key bị từ chối để IdP không bao giờ giữ khoá mở được key AI). Bật cờ mà thiếu đường dẫn khoá thì IdP không khởi động, nên không có trạng thái "bật một nửa". Mục Scribe ở `/admin` và các route của nó chỉ có khi có cả hai; tắt cờ rồi restart thì mục, route, client `scribe-web` của tenant sổ, `webApps.scribe` và bản niêm phong qua API nội bộ đều biến mất.
- Tenant bật Scribe khi có ít nhất một key **chép lời** (ElevenLabs, OpenAI, Gemini): lưu key chép lời đầu tiên đặt `tenant.scribe.enabledAt`, gỡ key chép lời cuối bỏ trường đó. Key Anthropic chỉ dùng cho model chữ nên một mình nó không bật Scribe. Mỗi thay đổi ghi `tenant.configured` (chỉ tên mục, `scribe-<vendor>`) và dựng lại runtime của tenant.

### 2. Key AI niêm phong cho Scribe

- Bốn loại secret mới trong `tenant_secrets`: `scribe-elevenlabs`, `scribe-openai`, `scribe-gemini`, `scribe-anthropic`. Document mang `sealedFor: "scribe"`, `hint` (4 ký tự cuối, để owner nhận ra key), `status?`/`statusAt?` (Scribe báo) và `forProvisioner: true`.
- `forProvisioner: true` giữ nghĩa "IdP không mở được", có chủ đích: `get()` và `resealStale()` của bản hiện tại lẫn mọi bản cũ đều bỏ qua document mang cờ này, nên revert code không làm IdP lỗi khi niêm phong lại lúc khởi động. `sealedForProvisioner` lọc theo `_id` `<tenantId>:dns-cloudflare` nên không lẫn.
- Niêm phong bằng `sealForRecipient` (`src/tenants/secret-keyring.ts`), dạng tổng quát của cách niêm phong token DNS cho provisioner: khoá AES-256-GCM ngẫu nhiên mỗi lần (IV 12 byte, tag 16 byte), AAD `<tenantId>\nscribe-<vendor>`, khoá AES bọc bằng RSA-OAEP SHA-256 (MGF1 SHA-256). Kết quả `{ kid: "recipient", iv, ciphertext, tag, wrappedKey, recipient }`, mọi phần nhị phân là base64url không padding. `recipient` là 16 ký tự hex đầu của SHA-256 trên SPKI DER của public key. `sealForProvisioner` gọi cùng hàm và giữ nguyên định dạng cũ (`kid: "provisioner"`, không `recipient`), nên provisioner không đổi.
- Trước khi lưu, IdP kiểm key bằng đúng các lượt gọi rẻ, không tốn credit mà Scribe dùng cho "Key riêng" (`scribe-next/server/scribe-be/src/user_keys/check.rs`): ElevenLabs `POST /v1/single-use-token/realtime_scribe`, OpenAI `GET /v1/models`, Gemini `GET /v1beta/models?pageSize=1`, Anthropic `GET /v1/models?limit=1`. Key chỉ đi trong header, timeout 10 giây, không theo redirect, không log body, URL hay thông điệp của nhà cung cấp. Bị từ chối, hết credit hay không kiểm được thì không lưu. Tên trường form `apiKey` nằm trong `REDACT_PATHS` của logger.
- Vector thử chéo ngôn ngữ (khoá RSA-3072 chỉ dùng cho test) ở `src/__tests__/fixtures/scribe-sealed-vector.json`; test của IdP mở lại nó, test của Scribe chép tệp này để kiểm phía Rust mở đúng.

### 3. Ngoại lệ có chủ đích của "không API nào trả secret"

Route nội bộ `GET /internal/tenants/:id/scribe-keys` trả **bản niêm phong** (không bao giờ bản rõ) cho role `scribe`, cùng loại với token DNS mà `/internal/certificates/work` trả cho provisioner: người gọi chỉ nhận đúng thứ được niêm phong cho chính nó. `POST /internal/tenants/:id/scribe-keys/:vendor/status` cho Scribe báo key `invalid | quota | unreadable` kèm `recipient` (vân tay khoá niêm phong đã mở) và tuỳ chọn `tag` (tag AES-GCM của bản niêm phong đã mở). IdP chỉ ghi khi `recipient` khớp bản đang lưu (báo cáo về bản niêm phong cho khoá đã xoay không đè trạng thái) và, khi có `tag`, khi `tag` khớp: mỗi lần owner lưu lại key là một lần niêm phong mới với `tag` mới, nên báo cáo muộn về key cũ không đánh dấu key owner vừa nhập. `recipient` một mình không làm được việc đó (cùng khoá niêm phong thì cùng `recipient`), nên Scribe nên luôn gửi `tag`. Không chọn để Scribe đọc thẳng `tenant_secrets` (hai database riêng, phá ranh giới sở hữu của ADR 0006) hay nhét key vào lookup (lookup mở cho Localman, Tunelo).

### 4. Phía Scribe: RUSTSEC-2023-0071 (Marvin)

Scribe mở bản niêm phong bằng crate `rsa` (thuần Rust), có cảnh báo RUSTSEC-2023-0071: giải mã RSA không hằng thời gian, kẻ tấn công đo thời gian của rất nhiều lượt giải mã bản mã do họ chọn có thể khôi phục bản rõ. Chấp nhận vì Scribe không phải oracle giải mã: nó chỉ mở blob do IdP tạo, nhận qua loopback có Basic credentials; lỗi giải mã không trả ra mạng và không phân biệt loại lỗi. Ghi lại ở ADR 0001 của Scribe.

### 5. Xoay khoá niêm phong

- Theo kế hoạch: thêm private key mới vào thư mục khoá của Scribe, restart Scribe; trỏ `SCRIBE_SEALING_PUBLIC_KEY_PATH` sang public key mới, restart IdP. Key cũ vẫn mở bằng khoá cũ (Scribe chọn khoá theo `recipient`); owner lưu lại key thì document mang `recipient` mới. Khoá cũ chỉ gỡ khi không còn document nào mang `recipient` cũ.
- Khi lộ khoá: mọi key AI niêm phong cho khoá đó coi như lộ; báo owner thu hồi ở nhà cung cấp và nhập key mới. Gỡ ngay khoá cũ ở Scribe: document cũ báo `unreadable`, `/admin` hiện "cần nhập lại".

### 6. Client, chứng chỉ và danh mục

- Tenant sổ đã bật có đúng một client `scribe-web` (web, back-channel logout; không mobile, không dev). Secret `base64url(HMAC-SHA256(appClientKey(APP_CLIENT_SECRET_KEY, "scribe-web"), tenantId))` như `localman-web`, `chat-web` (ADR 0006 §5).
- `scribe.<d>` là lineage chứng chỉ riêng, không vào chứng chỉ `<d>` và không vào `APP_HOST_KEYS`: kiểm sở hữu đòi mọi host trong đó trỏ về máy và đình chỉ sau 3 lần sai, còn HTTP-01 hỏng một tên làm hỏng cả chứng chỉ chung. Thiếu bản ghi `scribe.` không bao giờ làm tenant bị đình chỉ. Hàng đợi chỉ đưa việc Scribe cho provisioner tự xin (`GET /internal/certificates/work?kinds=hosts,scribe`): provisioner cũ không hiểu `kind` sẽ coi việc Scribe là việc của chứng chỉ chung (cấp lại, hay tệ hơn là xoá `<d>` và `wildcard.<d>` khi việc là gỡ), nên nó không bao giờ thấy việc đó. Block 443 của Scribe tenant (repo `scribe-next`) phải đặt tên nhóm bắt `(?<tenant>` hoặc `(?<d>` trong regex `server_name`, nếu không provisioner coi block đó là xung đột tên và từ chối cấp.
- Trang `/apps` của tenant sổ hiện Scribe khi tenant đã bật **và** chứng chỉ `scribe.<d>` đã cấp (`scribeCertificate.status = issued`): không bao giờ đưa người dùng tới link hỏng TLS. Báo cáo của provisioner làm chứng chỉ chuyển sang hay rời `issued` thì dựng lại runtime để `/apps` đổi theo. Client `scribe-web` và `webApps.scribe` ở lookup nội bộ không chờ chứng chỉ: Scribe cần chúng để tự cài đặt trước khi có chứng chỉ. Tenant chính giữ nguyên. Nút chuyển app của Chat và Localman giữ Scribe chỉ cho tenant chính ở đợt này.

### 7. Tenant chuyển đi và bundle tự host

Dữ liệu và key Scribe không đi theo khi tenant chuyển sang máy của owner (ADR 0007 §7): `sealTenantSecrets` chỉ niêm phong lại các loại của IdP và không có loại `scribe-*`; `tenant_secrets` không nằm trong `IDP_COLLECTIONS` của `export-tenant.sh`. Bundle tự host không có Scribe. Gỡ tenant xoá luôn các document `scribe-*` cùng mọi secret khác của nó; dữ liệu phía Scribe do người vận hành xoá (`scribe-be admin purge-tenant`).

## Giới hạn đã biết

Như ADR 0006 §7: trên máy chủ dùng chung IdP (pm2) đang chạy bằng root, nên IdP bị chiếm thì đọc được private key của Scribe và mở được key AI của mọi tenant. Câu "IdP không đọc lại được" chỉ đúng khi IdP chạy bằng user riêng; việc đó đổi cách chạy của máy dùng chung và cần user quyết.

## Hệ quả

- Production không đổi cho tới khi bật `SCRIBE_TENANTS` và cấu hình khoá: tenant chính, app iPhone/Android và mọi tenant chưa nhập key giữ nguyên hành vi.
- IdP gọi ra bốn nhà cung cấp AI lúc owner lưu key (một lượt mỗi lần lưu).
- Rollback: tắt `SCRIBE_TENANTS`, restart. Document `scribe-*` còn lại vô hại (không runtime nào của IdP mở chúng); muốn dọn hẳn thì xoá document có `_id` chứa `:scribe-` sau backup.
