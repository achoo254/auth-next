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

## Hệ quả

- Snapshot `primary-tenant-snapshot` chứng minh tenant chính không đổi: chuỗi ba ngôn ngữ, discovery, client tĩnh, tên và thuộc tính cookie (không `Domain`, giữ tiền tố `__Host-`/`__Secure-`), trang `/apps`, `/privacy`. Issuer, `kid`, client id không đổi.
- Cookie đều host-only nên trình duyệt đã tách cookie theo host của từng tenant; không có cookie theo tenant.
- Thêm env `TENANT_DOMAIN`, `TENANT_DISPLAY_NAME` (mặc định là cấu hình hiện tại của hoandat.com).
- `urn:hoandat:auth:event:` (loại Security Event Token) và client id `hoandat-account` giữ nguyên: là định danh hợp đồng, không phải chữ hiển thị.
