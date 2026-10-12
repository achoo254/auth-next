# ADR 0005: Thêm RS256 cho ID token, giữ ES256 làm mặc định

- Trạng thái: chấp nhận
- Ngày: 2026-10-12
- Phạm vi: khoá ký, discovery và thuật toán ký ID token của IdP; thay một phần ADR 0001 (mục 3 câu "Discovery chỉ quảng bá `ES256`", mục 4 câu "Khoá đầu tiên … dùng để ký")

## Bối cảnh

ADR 0001 chọn ES256 cho mọi token và chỉ quảng bá `ES256` trong discovery. Ngày 2026-10-12 bộ conformance của OpenID Foundation (test plan Config OP, chạy trên production `https://auth.hoandat.com`) cho 37 ca đạt và **1 ca lỗi**: OpenID Connect Discovery 1.0 mục 3 bắt buộc `id_token_signing_alg_values_supported` phải có `RS256`. 6 ca còn lại chỉ là thông tin về tính năng tuỳ chọn (request object, tham số `claims`), không làm hỏng chứng nhận.

IdP xác thực cho mọi app hiện có và mọi app sẽ tích hợp sau này. Một số thư viện OIDC chuẩn chờ RS256 cho ID token khi client không khai thuật toán. Jev (2026-10-12, 0.98) chọn thêm RS256 thay vì giữ chỉ ES256 và ghi nhận lệch chuẩn (0.02); chủ sản phẩm duyệt, kể cả ghi khoá RSA lên production.

## Quyết định

### 1. RS256 chỉ cho ID token, ES256 vẫn là mặc định

- Discovery quảng bá `id_token_signing_alg_values_supported: ["ES256", "RS256"]`.
- Mặc định của client vẫn là ES256 (`clientDefaults.id_token_signed_response_alg`). Client tĩnh hiện có (`localman-web`, `tunelo-cli`, `tunelo-web`, `hoandat-account`) không đổi gì. Client tĩnh mới cần RS256 thì khai `id_token_signed_response_alg: "RS256"` trong `src/oidc/clients.ts`.
- Access token (`typ: at+jwt`) và Security Event Token của audit **vẫn chỉ ký ES256**; resource server vẫn kiểm `algorithms: ["ES256"]`.
- Client MCP đăng ký động không nhận ID token (policy DCR từ chối scope `openid`), nên không bị ảnh hưởng.

### 2. Một file khoá, khoá đầu tiên **của mỗi thuật toán** ký

- `secrets/signing-keys.json` chứa khoá EC P-256 (`alg: ES256`) và khoá RSA (`alg: RS256`, tối thiểu 2048 bit). File phải có ít nhất một khoá ES256; khoá RSA không bắt buộc ở môi trường dev/test.
- Khoá ký của mỗi thuật toán là khoá **đầu tiên có thuật toán đó** trong mảng `keys` (`primarySigningKey`, `rsaSigningKey` trong `src/oidc/jwks.ts`), không còn là `keys[0]`. Các khoá sau cùng thuật toán chỉ được công bố để xác minh.
- RS256 chỉ được quảng bá khi file có khoá RSA (`idTokenSigningAlgs`). Nhờ vậy deploy code trước rồi mới thêm khoá, hay ngược lại, đều không làm IdP khởi động hỏng.
- Sinh khoá: `node dist/generate-signing-key.mjs secrets/signing-keys.json --alg RS256` (local: `pnpm generate-key <file> --alg RS256`). Script từ chối tạo file chỉ có khoá RSA.
- Xoay khoá giữ đúng quy trình ADR 0001 mục 4, áp dụng riêng cho từng thuật toán: thêm khoá mới cùng thuật toán vào cuối, đợi app cache JWKS, rồi chuyển nó lên trước các khoá **cùng thuật toán**.

### 3. Không để tụt chuẩn lặng lẽ

- `scripts/seed-clients.ts` (kiểm production, chỉ đọc) báo lỗi khi discovery thiếu `ES256` hoặc `RS256`, hoặc khi JWKS không công bố khoá ký của một trong hai thuật toán.

## Hệ quả

- `/jwks` công bố thêm một khoá RSA. Localman và Tunelo chọn khoá theo `kid` (`createRemoteJWKSet` của `jose`) nên không phải đổi gì.
- App tích hợp mới dùng thư viện OIDC mặc định RS256 chạy được ngay; app tự chọn ES256 vẫn được ES256.
- Thêm một khoá riêng phải giữ bí mật và xoay vòng. Khoá RSA chỉ nằm trên server, không vào repo, giống khoá EC.
- Đường lùi: xoá khoá RSA khỏi file và restart. Discovery quay về chỉ ES256, không client hiện có nào bị ảnh hưởng.
