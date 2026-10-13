# ADR 0006: Tenant theo domain, dữ liệu gắn `tenantId`

- Trạng thái: chấp nhận
- Ngày: 2026-10-13
- Phạm vi: mô hình dữ liệu, resource/audience, client tĩnh và chuỗi hiển thị của IdP; nền cho Localman và Tunelo đa tenant (plan `plans/dattqh/261013-0043-multi-tenant-by-domain/`)

## Bối cảnh

IdP gắn cứng với `hoandat.com`: một issuer, một bộ audience (`https://localman.hoandat.com`, `https://tunnel.hoandat.com`), chữ "hoandat" trong giao diện, 5 chỉ mục unique toàn cục trên `accounts`. Mục tiêu (hợp đồng brainstorm 2026-10-13): chủ một domain nhận domain đó và có `auth.`, `localman.`, `tunnel.` riêng trên domain của họ, với tài khoản và dữ liệu cô lập; `hoandat.com` là tenant số 1 và chạy tiếp không gián đoạn. Jev chọn cô lập bằng trường `tenantId` trên mọi collection, không dùng database riêng (0.97): user MongoDB `auth` chỉ có `readWrite` trên một database.

## Quyết định

### 1. Tenant

- `Tenant` (`src/tenants/tenant.ts`): `id`, `domain`, `displayName`, `issuer`, `status`, `webApps`. Hostname theo quy ước dưới domain (`appHostsFor`): `auth.`, `localman.`, `*.localman.`, `tunnel.`, `*.tunnel.`.
- Tenant chính dựng từ env (`src/tenants/env-tenant.ts`): `id` cố định `primary`, `issuer = ISSUER` (không ép dạng, harness conformance dùng issuer bất kỳ), `domain = TENANT_DOMAIN` (mặc định `hoandat.com`), tên hiển thị `TENANT_DISPLAY_NAME` (mặc định `hoandat`), web app từ `LOCALMAN_WEB_URL`/`TUNELO_WEB_URL`.
- Domain nào đi vào DNS, certbot hay nginx cũng phải qua `normalizeTenantDomain`: chỉ nhãn LDH/punycode, ≤ 253 ký tự, bỏ cổng và dấu chấm cuối, không IP, không public suffix (Public Suffix List qua `tldts`, gồm cả domain riêng như `github.io`), không nằm dưới domain cấm.

### 2. Resource, client, chuỗi hiển thị theo tenant

- Audience suy từ domain (`resourcesFor`): `https://localman.<d>`, `https://localman.<d>/mcp`, `https://tunnel.<d>`. `createResourcePolicy` dựng chính sách resource cho từng tenant; DCR, `defaultResource`, `getResourceServerInfo` và token exchange chỉ biết resource của tenant mình. Token exchange chỉ ra `https://tunnel.<d>` của chính tenant.
- Client id giữ nguyên ở mọi tenant (`localman-web`, `tunelo-cli`, `tunelo-web`, `hoandat-account`); redirect, audience, tên (`Tài khoản <brand>`) và secret là của tenant.
- Chuỗi giao diện dùng `{brand}` và `{brandDomain}`, translator tự điền từ tenant của request (`bindRequestTenant`, `requestTenant`). Không còn "hoandat" cố định trong i18n, layout, minh hoạ, nhãn first-party, mẫu tên giả first-party.

### 3. Dữ liệu

- Mọi document của `accounts`, `one_time_tokens`, `audit_outbox`, `session_meta`, `grant_meta` và các `oidc_*` mang `tenantId` (`TENANT_COLLECTIONS`). Chỉ các module tầng dữ liệu được gọi `db.collection(...)` (test `tenant-source-scan`); mọi truy vấn của chúng thêm `inTenant(tenant)`, mọi ghi thêm `tenantTag(tenant)`. Repository nhận tenant bắt buộc trong constructor.
- Adapter của `oidc-provider` ghi `replaceOne({ _id, tenantId }, …, upsert)`: id thuộc tenant khác làm ghi lỗi trùng `_id` thay vì ghi đè. Client tĩnh không bao giờ đi qua adapter; client DCR lưu theo tenant.
- 5 khoá unique của `accounts` thành chỉ mục ghép `{ tenantId, X }` (`tenant_username`, `tenant_email_when_set`, `tenant_providers_google`, `tenant_providers_github`, `tenant_telegram_chat`): cùng tài khoản Google đăng ký được ở mỗi tenant một lần. `conflictField` bỏ qua `tenantId`.

### 4. Chuyển đổi không gián đoạn và giới hạn của nó

- **Đọc tương thích có thời hạn:** tenant chính khớp `tenantId: { $in: ["primary", null] }` (`ownsUntaggedData`), nên phiên, refresh token, grant, tài khoản tạo trước khi deploy vẫn dùng được trước và trong lúc backfill. Tenant khác không bao giờ thấy document chưa gắn.
- **Thứ tự rollout:** backup → deploy (`infra/deploy.sh` chạy `create-tenant-indexes` sau khi cài dependency, trước khi reload, nên khởi động chỉ còn no-op) → `node dist/backfill-tenant-id.mjs --dry-run` → `node dist/backfill-tenant-id.mjs` (báo 0 document còn thiếu) → kiểm Localman/Tunelo đăng nhập, refresh, token exchange, Config OP.
- 5 chỉ mục unique toàn cục cũ **giữ nguyên** trên production tới cổng cuối phase 02 (với một tenant chúng vẫn đúng); database mới chỉ có chỉ mục ghép.
- **Cổng trước tenant thứ hai (cuối phase 02):** backfill lần cuối báo 0 ở mọi collection, gỡ đọc tương thích (`ownsUntaggedData`) và 5 chỉ mục unique cũ. Chỉ sau đó mới được tạo tenant thứ hai.
- **Chỉ sửa tiến sau tenant thứ hai:** không deploy lại code chưa có tenant (nó tạo lại chỉ mục unique toàn cục, crash-loop hoặc gửi audit sai tenant). Sự cố thì sửa tiến hoặc tạm `suspended` tenant mới. Trước cổng đó, lùi bằng deploy lại commit trước là an toàn (trường `tenantId` và chỉ mục ghép vô hại với code cũ); lùi xong phải chạy lại backfill trước khi tiến tiếp.

### 5. Runtime đa tenant (phase 02)

- **Sổ tenant** `tenants` (IdP là nguồn duy nhất): `_id` `ten_<ngẫu nhiên>` không tái dùng (domain nhận lại bắt đầu trống), `domain` unique, `status` `pending_claim|claimed|active|suspended`, owner (danh tính upstream), TXT đã chứng minh, trạng thái chứng chỉ, lần kiểm sở hữu.
- **Chọn tenant theo Host** ở dispatcher ngoài cùng (`src/http/tenant-dispatcher.ts`): host của issuer chính và `ALLOWED_HOSTS` → tenant chính; `auth.<d>` của tenant `claimed`/`active` → tenant đó; còn lại `421` (giữ mã cũ: discovery theo Host). Rate limit một store toàn process, khoá `(tenantId, IP)`.
- **`TenantRuntime`** của tenant sổ (provider, store, upstream, bot) dựng lười khi có request đầu, single-flight, giữ tới khi tenant bị đình chỉ (không loại khỏi cache); tối đa `TENANT_MAX_ACTIVE` (vượt thì `503`). Tenant chính dựng lúc khởi động và ghim. Host lạ được nhớ 60 giây.
- **Secret của tenant** trong `tenant_secrets`, AES-256-GCM, AAD `tenantId` + loại, khoá theo vòng `TENANT_SECRETS_KEY` (khoá đầu niêm phong). Token DNS Cloudflare niêm phong bằng public key RSA của provisioner (RSA-OAEP-256 bọc khoá AES): IdP giữ nhưng không mở được.
- **Ngoại lệ của "khoá ký chỉ nằm trong file":** khoá ký của tenant sổ (một ES256, một RS256) sinh lần đầu dùng và lưu niêm phong trong `tenant_secrets`; tenant chính vẫn dùng file `SIGNING_KEYS_PATH`. Mất `TENANT_SECRETS_KEY` là mất khoá ký của mọi tenant sổ: backup khoá là bắt buộc trước khi có tenant thứ hai.
- **Secret client** `localman-web`/`tunelo-web` của tenant sổ = HMAC-SHA256(`APP_CLIENT_SECRET_KEY`, `<tenantId>:<clientId>`); app tự tính, không API nào trả secret, owner không xem hay xoay được. Tenant chính giữ secret từ env.
- **API nội bộ** trên listener loopback riêng (`INTERNAL_HOST:INTERNAL_PORT`), Basic credentials riêng từng app (`localman`, `tunelo`, `provisioner`), so sánh constant-time: tra tenant theo Host, JWKS và discovery của tenant (app không tin DNS công khai của tenant để lấy khoá), hàng đợi chứng chỉ cho provisioner (backoff 1 giờ nhân đôi, trần 24 giờ). nginx trả `404` cho `/internal`.
- **Audit:** một dispatcher duyệt outbox chung; sự kiện của tenant sổ gửi tới `https://localman.<d>/internal/audit-events`, ký bằng khoá của tenant (đọc từ kho khoá, không cần runtime), cùng bộ Basic credentials; tenant bị đình chỉ thì sự kiện chờ với backoff.
- **Kiểm lại sở hữu** cứ 6 giờ (khi có `SERVICE_IPV4`): TXT `_auth-claim.<d>` còn đúng và A của `auth.`, `localman.`, `tunnel.` cùng hai wildcard (dò bằng nhãn ngẫu nhiên) trỏ đúng IP của máy; sai 3 lần liền thì `suspended` và runtime bị bỏ. Báo owner thuộc phase 03.

## Hệ quả

- Snapshot `primary-tenant-snapshot` chứng minh tenant chính không đổi: chuỗi ba ngôn ngữ, discovery, client tĩnh, tên và thuộc tính cookie (không `Domain`, giữ tiền tố `__Host-`/`__Secure-`), trang `/apps`, `/privacy`. Issuer, `kid`, client id không đổi.
- Cookie đều host-only nên trình duyệt đã tách cookie theo host của từng tenant; không có cookie theo tenant.
- Thêm env `TENANT_DOMAIN`, `TENANT_DISPLAY_NAME` (mặc định là cấu hình hiện tại của hoandat.com).
- `urn:hoandat:auth:event:` (loại Security Event Token) và client id `hoandat-account` giữ nguyên: là định danh hợp đồng, không phải chữ hiển thị.
