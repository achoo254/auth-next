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

- **Đọc tương thích có thời hạn (bản đầu, commit `59dd1df`):** tenant chính khớp `tenantId: { $in: ["primary", null] }`, nên phiên, refresh token, grant, tài khoản tạo trước khi deploy vẫn dùng được trước và trong lúc backfill. Tenant khác không bao giờ thấy document chưa gắn. Đã gỡ ở cổng cuối phase 02 (dưới).
- **Thứ tự rollout:** backup → deploy (`infra/deploy.sh` chạy `create-tenant-indexes` sau khi cài dependency, trước khi reload, nên khởi động chỉ còn no-op) → `node dist/backfill-tenant-id.mjs --dry-run` → `node dist/backfill-tenant-id.mjs` (báo 0 document còn thiếu) → kiểm Localman/Tunelo đăng nhập, refresh, token exchange, Config OP.
- 5 chỉ mục unique toàn cục cũ **giữ nguyên** trên production tới cổng cuối phase 02 (với một tenant chúng vẫn đúng); database mới chỉ có chỉ mục ghép.
- **Cổng trước tenant thứ hai (cuối phase 02), tự động lúc khởi động:** mỗi lần khởi động, trước khi phục vụ, `migrateToTenants` gắn `tenantId` của tenant chính cho mọi document còn thiếu khi sổ tenant còn rỗng (khi đó chỉ tenant chính có thể đã ghi chúng; đã có tenant khác thì document thiếu `tenantId` là lỗi, không bao giờ âm thầm gán), gỡ 5 chỉ mục unique toàn cục cũ cùng các chỉ mục tra cứu cũ không có `tenantId`, rồi đếm lại; còn document chưa gắn thì **không khởi động** thay vì giấu dữ liệu của chủ nó. Bộ lọc tenant khớp `tenantId` đúng tuyệt đối cho mọi tenant. Thứ tự deploy vì vậy không thể sai: bản này deploy thẳng lên dữ liệu chưa gắn vẫn đúng. Tenant thứ hai chỉ có thể tồn tại trên code đã qua cổng này.
- **Chỉ sửa tiến sau tenant thứ hai:** không deploy lại code chưa có tenant (nó tạo lại chỉ mục unique toàn cục, crash-loop hoặc gửi audit sai tenant). Sự cố thì sửa tiến hoặc tạm `suspended` tenant mới. Trước cổng đó, lùi bằng deploy lại commit trước là an toàn (trường `tenantId` và chỉ mục ghép vô hại với code cũ); lùi xong phải chạy lại backfill trước khi tiến tiếp.

### 5. Runtime đa tenant (phase 02)

- **Sổ tenant** `tenants` (IdP là nguồn duy nhất): `_id` `ten_<ngẫu nhiên>` không tái dùng (domain nhận lại bắt đầu trống), `domain` unique, `status` `pending_claim|claimed|active|suspended`, owner (danh tính upstream), TXT đã chứng minh, trạng thái chứng chỉ, lần kiểm sở hữu.
- **Chọn tenant theo Host** ở dispatcher ngoài cùng (`src/http/tenant-dispatcher.ts`): host của issuer chính và `ALLOWED_HOSTS` → tenant chính; `auth.<d>` của tenant `claimed`/`active` → tenant đó; còn lại `421` (giữ mã cũ: discovery theo Host). Rate limit một store toàn process, khoá `(tenantId, IP)`.
- **`TenantRuntime`** của tenant sổ (provider, store, upstream, bot) dựng lười khi có request đầu, single-flight, giữ tới khi tenant bị đình chỉ (không loại khỏi cache); tối đa `TENANT_MAX_ACTIVE` (vượt thì `503`). Mỗi thay đổi cấu hình hay trạng thái tăng `configVersion` của tenant; runtime dựng từ phiên bản cũ được dựng lại ở request sau. Tenant chính dựng lúc khởi động và ghim; không tenant sổ nào nằm ở, trên hay dưới domain của tenant chính. Host lạ được nhớ 60 giây.
- **Secret của tenant** trong `tenant_secrets`, AES-256-GCM, AAD `tenantId` + loại, khoá theo vòng `TENANT_SECRETS_KEY` (khoá đầu niêm phong). Token DNS Cloudflare niêm phong bằng public key RSA của provisioner (RSA-OAEP-256 bọc khoá AES): IdP giữ nhưng không mở được.
- **Xoay khoá:** khoá mới đặt lên đầu `TENANT_SECRETS_KEY`; mỗi lần khởi động IdP niêm phong lại mọi secret còn mang khoá cũ (log `Tenant secrets re-sealed`), sau đó mới được bỏ khoá cũ.
- **Ngoại lệ của "khoá ký chỉ nằm trong file":** khoá ký của tenant sổ (một ES256, một RS256) sinh lần đầu dùng và lưu niêm phong trong `tenant_secrets`; tenant chính vẫn dùng file `SIGNING_KEYS_PATH`. Mất `TENANT_SECRETS_KEY` là mất khoá ký của mọi tenant sổ: backup khoá là bắt buộc trước khi có tenant thứ hai.
- **Secret client** `localman-web`/`tunelo-web` của tenant sổ: IdP giữ khoá gốc `APP_CLIENT_SECRET_KEY`; mỗi app nhận khoá riêng `HMAC-SHA256(gốc, "app-client-key\n<clientId>")` (`dist/app-client-key.mjs`), secret = `HMAC-SHA256(khoá app, tenantId)`. Lộ khoá của một app không lộ secret của app kia (user chọn 2026-10-13, thay cho một khoá chung trong plan). Không API nào trả secret, owner không xem hay xoay được. Tenant chính giữ secret từ env.
- **API nội bộ** trên listener loopback riêng (`INTERNAL_HOST:INTERNAL_PORT`), Basic credentials riêng từng app (`localman`, `tunelo`, `provisioner`), so sánh constant-time: tra tenant theo Host, JWKS và discovery của tenant (app không tin DNS công khai của tenant để lấy khoá), hàng đợi chứng chỉ cho provisioner (backoff 1 giờ nhân đôi, trần 24 giờ). nginx trả `404` cho `/internal`.
- **Audit:** một dispatcher duyệt outbox chung; sự kiện của mọi tenant gửi tới **một** intake `AUDIT_EVENTS_URL` (Localman là một process cho mọi tenant), ký bằng khoá của tenant với `iss` của tenant (đọc từ kho khoá, không cần runtime). Không bao giờ gửi credentials theo DNS của tenant (user chọn 2026-10-13, thay cho URL `https://localman.<d>/...` trong plan). Tenant không dựng được người ký hay bị đình chỉ chỉ hoãn sự kiện của chính nó (backoff), không chặn tenant khác.
- **Kiểm lại sở hữu** (khi có `SERVICE_IPV4`): mỗi giờ một lượt, kiểm các tenant quá 6 giờ chưa kiểm; TXT `_auth-claim.<d>` còn đúng và A của `auth.`, `localman.`, `tunnel.` cùng hai wildcard (dò bằng nhãn ngẫu nhiên) trỏ đúng IP của máy. Chỉ câu trả lời dứt khoát (không có bản ghi, sai giá trị, sai IP) mới tính là thất bại; lỗi resolver bỏ qua; một lượt mà mọi tenant cùng thất bại bị coi là lỗi DNS cục bộ, không đình chỉ ai. Sai 3 lần liền thì `suspended` và runtime bị bỏ.

### 6. Nhận domain và quản trị tenant (phase 03)

- **Bắt đầu ở `https://<issuer chính>/claim`**, đã đăng nhập tài khoản của tenant chính. Owner là một danh tính Google/GitHub đã liên kết với tài khoản đó (`provider` + id; Google `sub` và GitHub id là định danh toàn cục nên khớp cả với OAuth app riêng của tenant). Lượt nhận nằm ở `tenant_claims` (domain không unique, TTL 24 giờ): nhiều người cùng nhận được một domain và không ai giữ chỗ domain mình không sở hữu; tenant chỉ được tạo khi xác minh xong.
- **Từ chối:** không phải domain hợp lệ, public suffix, TLD dành riêng, domain chính và mọi domain dưới nó, `CLAIM_BLOCKED_DOMAINS`, domain ở/trên/dưới một tenant có sẵn, quá 3 lượt đang chờ mỗi tài khoản, sổ đã đủ `TENANT_MAX_ACTIVE` tenant `claimed`/`active`, máy còn ít hơn `CLAIM_MIN_AVAILABLE_MB`, chưa có `SERVICE_IPV4`.
- **Xác minh:** TXT `_auth-claim.<d>` đúng giá trị của chính lượt nhận (ngẫu nhiên, gắn với lượt và danh tính) **và** A của `auth.`, `localman.`, `tunnel.`, hai wildcard trỏ đúng `SERVICE_IPV4`. Đạt thì tenant `claimed`, owner là danh tính của lượt nhận, chứng chỉ vào hàng đợi, audit `tenant.claimed`, mọi lượt nhận khác của domain chấm dứt. Không có "người đến trước làm owner".
- **Vào `/admin` của tenant** chỉ bằng liên kết một lần (2 phút) phát từ `/claim` khi owner vừa đăng nhập gần đây (chốt câu hỏi mở của plan: lần đầu tenant chưa có OAuth nào nên "đăng nhập lại bằng OAuth vừa khai" không dùng được; một cơ chế duy nhất cho mọi lần). Liên kết mở phiên quản trị 30 phút (cookie host-only ký bằng `COOKIE_KEYS`, gắn tenant và danh tính owner); mọi form có CSRF gắn với phiên.
- **Trang quản trị:** tên hiển thị, OAuth Google/GitHub (hiện callback cần đăng ký, chỉ hiện client id, không bao giờ hiện secret), token DNS Cloudflare (chỉ lưu khi tạo và xoá được một bản ghi TXT thử trong zone; niêm phong cho provisioner; chứng chỉ vào lại hàng đợi), bot Telegram tuỳ chọn (IdP tự đặt webhook với secret mới). Không gỡ được provider cuối cùng của tenant đang hoạt động. Mỗi thay đổi ghi `tenant.configured` (chỉ tên mục).
- **Kích hoạt:** tenant chuyển `active` khi có owner và ít nhất một provider; trước đó domain chỉ phục vụ `/admin` và tài nguyên tĩnh (mọi trang khác `404`, không có trang đăng nhập hay endpoint OIDC). `claimed` quá 7 ngày không kích hoạt thì `suspended` (`not-activated`), chứng chỉ vào hàng gỡ; khi provisioner báo đã gỡ, tenant bị xoá và domain được nhận lại.
- **Báo owner khi đình chỉ:** trạng thái hiện ở `/claim` của owner và audit `tenant.suspended`; không có kênh gửi tin riêng (không email theo ADR 0004).

### 7. Chứng chỉ và nginx (phase 04)

- **Không sinh conf nginx theo tenant.** Mỗi app ship block regex của mình (`tenant-auth.conf` ở repo này; block `localman.`/`tunnel.` ở `localman-next`), cùng một tệp cấp `http` (`tenants-http.conf`: map `$ssl_server_name` → tên chứng chỉ, log redact link `/admin/handoff`) và một block port 80 cho mọi host tenant (`tenants-acme.conf`: HTTP-01, còn lại 301). Block cụ thể của các host hiện có luôn thắng block regex.
- **Provisioner** (Node, root, systemd timer, `src/provisioner/`): đọc hàng đợi qua API nội bộ, kiểm lại domain bằng `normalizeTenantDomain` + danh sách cấm của chính nó (chỉ nhận giá trị đã chuẩn y nguyên), từ chối hostname đã có block khác (`nginx -T`), chạy certbot bằng `execFile` không shell; không reload nginx (chứng chỉ đọc theo SNI). Mặc định Let's Encrypt **staging** tới khi đổi tường minh. Gia hạn là timer riêng cho config-dir của tenant.
- Domain có nhãn đầu `auth`/`localman`/`tunnel` không nhận được (map chứng chỉ sẽ hiểu sai host).

## Hệ quả

- Snapshot `primary-tenant-snapshot` chứng minh tenant chính không đổi: chuỗi ba ngôn ngữ, discovery, client tĩnh, tên và thuộc tính cookie (không `Domain`, giữ tiền tố `__Host-`/`__Secure-`), trang `/apps`, `/privacy`. Issuer, `kid`, client id không đổi.
- Cookie đều host-only nên trình duyệt đã tách cookie theo host của từng tenant; không có cookie theo tenant.
- Thêm env `TENANT_DOMAIN`, `TENANT_DISPLAY_NAME` (mặc định là cấu hình hiện tại của hoandat.com).
- `urn:hoandat:auth:event:` (loại Security Event Token) và client id `hoandat-account` giữ nguyên: là định danh hợp đồng, không phải chữ hiển thị.
