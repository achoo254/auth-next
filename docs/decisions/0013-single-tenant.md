# ADR 0013: Đơn tenant `hoandat.com`, bỏ tenant theo domain, tự host và Scribe trên tenant

- Trạng thái: chấp nhận
- Ngày: 2026-10-24
- Phạm vi: toàn hệ sinh thái `*-next`: `auth-next` (IdP), `scribe-next`, `chat-next`, `localman-next` (gồm Tunelo), `shared-next`, `miu-world-next`. Đây là ADR đơn tenant duy nhất; ADR tenant của các repo khác đánh dấu superseded và trỏ về đây. Plan thực thi: `plans/dattqh/261024-2129-single-tenant-npm-packages/` ở thư mục workspace `hoandat-app` (ngoài repo).
- Thay thế: ADR [0006](0006-tenants-by-domain.md) (tenant theo domain), [0007](0007-self-hosted-tenants.md) (tenant tự host, chuyển tenant), [0012](0012-scribe-on-tenants.md) (Scribe trên tenant sổ).

## Bối cảnh

Từ 13/10/2026 IdP phục vụ thêm domain do người khác nhận (ADR 0006), từ 17/10 có chế độ tự host (ADR 0007), từ 24/10 có Scribe trên tenant (ADR 0012). Đo trên production lúc 22:2x ngày 24/10/2026: ngoài `hoandat.com` chỉ có hai tenant, `inetdev.io.vn` (`active`) và `hoandat.io.vn` (`self_hosted`), mỗi tenant một tài khoản, cùng email với chủ máy. Không có người dùng ngoài.

Để giữ hai tenant đó, mỗi repo phải mang: sổ tenant, runtime chọn theo Host, secret niêm phong theo tenant, secret client suy từ khoá gốc, API nội bộ trên loopback, provisioner chứng chỉ chạy root, block nginx dùng map `$tenant_*`, process `chat-api-<tenant>`, key AI niêm phong cho Scribe, bundle tự host và image GHCR. Hệ sinh thái do một người vận hành cùng AI agent; mỗi phần trên là secret phải giữ, đường code phải kiểm và cấu hình dùng chung trên máy `.65` phải cẩn thận.

Ngày 24/10/2026 lúc 21:00, user quyết định: bỏ đa tenant, giữ trường `tenantId`, gỡ hẳn tự host. Bổ sung cùng tối: `hoandat.io.vn` không giữ gì; các gói dùng chung publish lên npm với scope `@achoo254`; không thu hồi token Cloudflare hay key AI của tenant (chỉ xoá mọi bản sao, không secret nào lên git hay npm); huỷ khoá niêm phong của Scribe và khoá provisioner thay vì lưu trữ.

## Quyết định

### 1. Một tenant, cấu hình từ env

- Hệ sinh thái chỉ phục vụ `hoandat.com`. IdP dựng đúng một runtime từ env (`buildPrimaryRuntime`, `src/tenants/tenant-runtime.ts`), id cố định `primary`, phục vụ ở host của `ISSUER` và `ALLOWED_HOSTS`; host khác nhận 421 như trước.
- Domain vẫn cấu hình bằng env, không cố định trong code: `TENANT_DOMAIN`, `TENANT_DISPLAY_NAME` và URL của từng app ở IdP; `TENANT_DOMAIN` ở Chat; build config ở Scribe; host được phép ở Localman và Tunelo. Resource, audience, client tĩnh và chuỗi hiển thị vẫn suy từ tenant như ADR 0006 mục 2.

### 2. Giữ `tenantId` trong dữ liệu, không migrate

- Mọi document và hàng giữ `tenantId`/`tenant_id` với giá trị `primary`. Không xoá trường, không đổi hay gỡ chỉ mục, không migrate.
- Lọc theo tenant vẫn ở tầng dữ liệu: `inTenant`/`tenantTag`, `TENANT_COLLECTIONS`, chỉ mục dẫn đầu bằng `tenantId`, test `tenant-source-scan`, `tenant-data-isolation`, `tenant-isolation`, `tenant-command-audit` (helper test giữ `OTHER_TEST_TENANT` để chứng minh dữ liệu mang `tenantId` lạ không bao giờ đọc được). Lý do: bỏ lọc đụng hàng trăm call site ở mỗi repo mà không đổi gì cho người dùng, còn giữ lại thì không tốn gì và chặn được dữ liệu sót.
- Hợp đồng mà app di động đã phát hành đang đọc giữ nguyên: `GET /api/idp` của Scribe (`{ displayName, domain, issuer, primary, scribe }`), `tenant_name` của Chat (bằng `TENANT_DOMAIN`), trường `canDelete` của `/api/account` (giờ luôn `true`).

### 3. Gỡ khỏi `auth-next`

- Nhận domain `/claim`, `/admin` của tenant, cổng "tenant chưa active", trang hướng dẫn `/guide/domain` cùng ảnh của nó.
- Sổ tenant và runtime dựng lười, kiểm sở hữu định kỳ, đình chỉ, enrollment (`/.well-known/hoandat-enrollment`), chuyển tenant, bundle `deploy/self-hosted/` và workflow `selfhosted-release`.
- Secret niêm phong (`TenantSecrets`, keyring), secret client suy bằng HMAC từ `APP_CLIENT_SECRET_KEY`, client `scribe-web` của tenant sổ, key AI niêm phong cho Scribe.
- API nội bộ trên loopback (cổng `4501`), provisioner chứng chỉ cùng unit systemd và các file nginx tenant.
- Script chỉ phục vụ những phần trên (`tenant-provisioner`, `import-tenant`, `purge-tenant`, `export-tenant-secrets`, `backfill-tenant-id`, `app-client-key`). `create-tenant-indexes` đổi tên thành `create-indexes` và chỉ còn chỉ mục `oidc_*` và tầng tài khoản.
- Lượt tự gắn `tenantId` lúc khởi động (`migrateToTenants`): production đã gắn xong từ 13/10/2026.
- Biến env: `SELF_HOSTED_CLAIMS`, `SCRIBE_TENANTS`, `SCRIBE_SEALING_PUBLIC_KEY_PATH`, `TENANT_SECRETS_KEY`, `APP_CLIENT_SECRET_KEY`, `TENANT_MAX_ACTIVE`, `PROVISIONER_PUBLIC_KEY_PATH`, `CLAIM_BLOCKED_DOMAINS`, `CLAIM_MIN_AVAILABLE_MB`, `ENROLLMENT_*`, `INTERNAL_API_CREDENTIALS`, `INTERNAL_HOST`, `INTERNAL_PORT`, `SERVICE_IPV4`. `parseEnv` bỏ qua biến lạ, nên `.env` còn các biến này vẫn khởi động được (test `env-removed-settings`).
- Xoá tài khoản (ADR 0009) mở cho mọi tài khoản; không còn bước xoá `tenant_claims`. Audit gửi sự kiện của outbox `primary`, ký bằng issuer của nó; các loại sự kiện `tenant.*` không còn.

### 4. Các repo khác

- **`scribe-next`**: bỏ tenant theo Host, danh bạ tenant, client API nội bộ của IdP, OIDC qua loopback, khoá app `scribe-web`, key AI niêm phong của tenant, lệnh quản trị theo tenant, nginx `scribe.<domain>`. Worker chỉ nhận việc `tenantId: "primary"`. ADR 0001 của repo superseded.
- **`chat-next`**: một process `chat-api`, không còn `chat-api-<tenant>`, `/opt/chat/tenants`, `setup-tenant.sh` hay `chat.tenants.conf`; server không đọc `TENANT_ID` (hằng `primary`), vẫn đọc `TENANT_DOMAIN`. ADR 0010 của repo superseded.
- **`localman-next`** (Localman và Tunelo): directory đơn tenant chỉ nhận host đã khai (host khác 421), bỏ client API nội bộ của IdP, chuyển tenant, nginx tenant; giữ plugin gắn `tenantId` và chỉ mục `tenant_*`. ADR tenant của repo superseded.
- **`shared-next`**: bỏ phần tenant trong gói (app switcher nhận prop `domain`), publish lên npm dưới scope `@achoo254` qua trusted publishing có provenance: `@achoo254/brand`, `@achoo254/app-switcher`, `@achoo254/capacitor-system-auth`. `chat-next` publish `@achoo254/chat-core`, `@achoo254/chat-platform`, `@achoo254/chat-platform-web`, `@achoo254/chat-proto` và `@achoo254/chat-bot-sdk`, không có URL backend mặc định (người dùng tự cấu hình backend). Consumer chuyển từ `@shared-next/*` sang `@achoo254/*` khi gói đã có trên registry.
  - Cập nhật 27/10/2026: tài khoản npm `achoo254` bị tạm khoá từ 24/10 và chưa được mở. Kênh chính thức tạm thời là tag git `github:achoo254/shared-next#<tag>&path:/packages/<tên>`; mọi consumer đã chuyển sang `@achoo254/*` từ tag `v0.5.1`. Hai SDK của Chat chưa phát hành, README hướng dẫn tự build tarball. Publish npm làm sau khi tài khoản mở lại, giữ đúng số phiên bản.

### 5. Production

- Dữ liệu của hai tenant phụ đã backup (thư mục riêng ngoài vòng xoay, có hạn xoá) rồi xoá ở IdP, Localman, Tunelo, Chat; Scribe vốn không có. DNS của `inetdev.io.vn` (phần tenant) và `hoandat.io.vn` đã gỡ, chứng chỉ tenant đã xoá.
- Bản sao token Cloudflare và key AI của tenant bị xoá (không thu hồi, theo quyết định của user). Khoá provisioner và khoá niêm phong của Scribe bị huỷ, không lưu trữ. Image `selfhosted-*` trên GHCR bị xoá.
- Collection `tenants`, `tenant_claims`, `tenant_secrets` của IdP drop sau khi code mới chạy (dump ngay trước đó). Trình tự đã chạy: git log của `docs/deployment-guide.md`.

## Phương án đã cân nhắc

- **Giữ code đa tenant nhưng tắt bằng cờ:** loại. Code tắt vẫn phải giữ secret, nginx và test, và vẫn là đường tấn công khi ai đó bật nhầm.
- **Bỏ luôn trường `tenantId` và chỉ mục theo tenant:** loại. Phải migrate năm database đang chạy và sửa hàng trăm call site, rủi ro cao mà người dùng không thấy khác biệt.
- **Giữ tự host, chỉ bỏ tenant chạy trên hoandat:** loại. Tự host cần chính gateway, enrollment và image phát hành mà user muốn gỡ.

## Hệ quả

- Không ai nhận được domain mới. Muốn có lại tenant thì cần ADR mới; dữ liệu vẫn mang `tenantId` nên không phải migrate ngược.
- Bề mặt vận hành của IdP nhỏ lại: một process, một cổng, không timer root, không file nginx dùng chung theo tenant, `.env` không còn khoá gốc nào ngoài khoá ký, cookie và secret client.
- Discovery, client tĩnh, cookie và `kid` của JWKS ở `auth.hoandat.com` không đổi: test `primary-tenant-snapshot` giữ nguyên snapshot, chỉ bỏ khỏi phần chụp chữ những chuỗi mà tenant chính chưa bao giờ hiện.
- `growth-report` vẫn đọc theo `tenantId` và giờ chỉ thấy `primary`.
