# Brainstorm: mọi app chạy theo domain (đa tenant theo hostname)

Ngày 2026-10-13. Đầu vào cho bước lập plan. Phạm vi gồm ba app: IdP `hoandat-auth` (repo này), Localman và Tunelo (repo `localman-next`). Các quyết định dưới đây do user chọn, kèm tư vấn của Jev (`jev-1.13.0`).

## Outcome

Chủ một domain trỏ DNS về IP của dịch vụ, nhận domain đó một lần (bước khởi tạo ở `https://auth.hoandat.com/claim`, cập nhật sau red-team 2026-10-13), và có trọn bộ app trên chính domain của họ; sau khi nhận, không gì đi qua hệ thống hoandat:

- `auth.<domain>`: IdP OpenID Connect riêng (issuer, khoá ký, tài khoản, client, OAuth Google/GitHub của họ).
- `localman.<domain>` và `*.localman.<domain>`: Localman (dashboard, API, mock, MCP) đăng nhập bằng `auth.<domain>`.
- `tunnel.<domain>` và `*.tunnel.<domain>`: Tunelo (server, trang web, tunnel) đăng nhập bằng `auth.<domain>`; CLI trỏ được tới server của tenant.

Giao diện mọi app hiển thị tên của tenant, không còn "hoandat" cố định. `hoandat.com` là tenant số 1 (`auth.hoandat.com`, `localman.hoandat.com`, `tunnel.hoandat.com`), dữ liệu và người dùng hiện có chạy tiếp không gián đoạn.

## Quyết định

| Câu hỏi | Lựa chọn | Jev |
|---|---|---|
| Kích hoạt domain mới | Chủ domain tự nhận bằng bản ghi DNS TXT, tự khai OAuth app Google/GitHub của họ; chưa khai thì chưa đăng nhập được | claim_flow 0.59, operator_approved 0.40, instant_auto 0.01 |
| Nơi bắt đầu nhận domain (red-team 2026-10-13) | HTTPS trên `auth.hoandat.com/claim`: người nhận đăng nhập trước, TXT gắn danh tính, owner là danh tính đó (thay cho trang HTTP trên domain của tenant, vốn chết với HSTS và bị chiếm owner qua log chứng chỉ) | trusted_https_host 1.00 |
| `tunnel.inetdev.io.vn` (red-team) | Gỡ hẳn trước phase Tunelo, không có alias | retire 0.73 |
| Lùi sau khi có tenant thứ hai (red-team) | Chỉ sửa tiến hoặc tạm đình chỉ tenant mới | forward_fix_only 1.00 |
| Tài khoản | Cô lập theo domain ở mọi app: tài khoản, phiên, grant, khoá ký, client, dữ liệu Localman, tunnel Tunelo riêng | isolated 0.99 |
| TLS hostname thường | Let's Encrypt HTTP-01 cấp lúc domain được nhận, tự gia hạn | acme_on_claim 0.90 |
| TLS wildcard (`*.localman.`, `*.tunnel.`) | DNS-01 với token API DNS của chủ domain (Cloudflare trước), lưu mã hoá | dns01_tenant_token 0.75, path_mock_dns01_tunnel 0.23, on_demand_http01 0.02 |
| Hostname trong tenant | Quy ước cố định: `auth.`, `localman.`, `*.localman.`, `tunnel.`, `*.tunnel.` dưới domain gốc | convention 0.96 |
| Sổ tenant | IdP là nguồn duy nhất; Localman và Tunelo tra tenant theo Host qua API nội bộ của IdP (có cache); issuer của tenant là `https://auth.<domain>` (Jev quyết, điểm kỹ thuật) | auth_owns 0.93 |
| Nơi chạy | **Tiếp tục trên máy .65 dùng chung** (user chọn khác lời khuyên) | dedicated 0.94, shared_65 0.06 |

## Hiện trạng đã đo (2026-10-13)

IdP (`hoandat-auth`):
- Một issuer (`ISSUER`) dùng ở 16 chỗ trong 9 tệp `src/`. `requireKnownHost` chỉ nhận host của issuer và `ALLOWED_HOSTS` (`src/app.ts`).
- Client tĩnh `localman-web`, `tunelo-cli`, `tunelo-web`, `hoandat-account` khai trong `src/oidc/clients.ts`, secret từ env.
- Một OAuth app Google và một GitHub (callback `https://auth.hoandat.com/oauth/{google,github}/callback`), một bot Telegram.
- Chữ "hoandat" trong i18n (`sign-in`, `consent`, `apps`, `telegram-bot`, 3 ngôn ngữ), wordmark ở `src/ui/layout.ts`, audience trong `src/oidc/resources.ts`.
- TLS qua Cloudflare proxy, origin dùng chứng chỉ tự ký chung; nginx chỉ `server_name auth.hoandat.com`.
- Mongo: user `auth` chỉ `readWrite` trên database `auth` (mongod dùng chung `27017`).

Localman và Tunelo (`localman-next`):
- Localman: một `OIDC_ISSUER`, một `PUBLIC_URL`, `MOCK_BASE_DOMAIN`, `OWNER_SUBS`, một bot Telegram, Turnstile, VAPID; mock theo wildcard `*.localman.hoandat.com` (chứng chỉ wildcard DNS-01 qua token Cloudflare của chủ hệ thống) và theo đường dẫn `/m/<secret>`; mongod riêng `127.0.0.1:27018`.
- Tunelo: một `AUTH_ISSUER`/`AUTH_AUDIENCE`, `TUNNEL_DOMAINS` đã nhận nhiều domain, wildcard `*.tunnel.hoandat.com`; CLI (gói npm `tunelo`) có server mặc định là hoandat.
- 96 dòng code không phải test chứa "hoandat" (i18n web, Tunelo web, CLI, config, routing).
- Hợp đồng chéo: token exchange Localman → Tunelo (`aud=https://tunnel.hoandat.com`), audit SET từ IdP sang Localman, back-channel logout.

Máy .65: khoảng 2,5 GB RAM trống cho cả chục app; pm2 restart IdP khi vượt 400 MB, Localman khi vượt 600 MB.

## Constraints

- Không gián đoạn tenant `hoandat.com`: issuer, `kid`, client, token, phiên, tài khoản, project/mock của Localman, tunnel và thiết bị Tunelo, token exchange, audit, back-channel logout giữ nguyên; CLI Tunelo đã cài vẫn chạy với server mặc định.
- Mọi quy tắc bảo mật trong `CLAUDE.md` của hai repo áp cho **từng** tenant (chỉ Google/GitHub theo ADR 0004, CSRF, không log secret, không gửi email, `securityVersion`, audit sau thao tác, token exchange chỉ trong cùng tenant).
- `oidc-provider` có một issuer cho mỗi `Provider` ⟹ một `Provider` cho mỗi tenant, tạo lười, cache có giới hạn.
- Cô lập tuyệt đối giữa tenant: token, cookie, dữ liệu, tunnel, mock của tenant A không truy cập được từ tenant B; Host không thuộc tenant nào bị từ chối.
- Secret của tenant (client secret OAuth, token API DNS, khoá ký, secret client app) không bao giờ in ra hay vào log, lưu mã hoá khi nằm trong Mongo; token DNS chỉ dùng để cấp/gia hạn chứng chỉ.
- Chạy trên .65 dùng chung ⟹ bắt buộc có trần: số tenant tối đa, cache `Provider`, rate limit theo tenant, chặn nhận domain khi hệ thống quá tải. nginx catch-all trên `443` và cấp chứng chỉ là cấu hình dùng chung của máy: đổi phải báo trước, luôn `nginx -t`.
- Chứng minh sở hữu domain trước khi cấp chứng chỉ hay tạo tenant; tôn trọng giới hạn tần suất của Let's Encrypt.

## Non-goals

- Danh tính dùng chung giữa các domain, SSO liên domain.
- Đăng nhập bằng mật khẩu/email hay phương thức ngoài Google/GitHub (ADR 0004 giữ nguyên).
- Thanh toán, gói dịch vụ, hạn mức theo tiền cho tenant.
- Chuyển sang máy riêng (user đã chọn .65; code giữ được khả năng chuyển sau này chỉ bằng cách đổi nơi deploy).
- Hostname tuỳ chọn ngoài quy ước `auth.`/`localman.`/`tunnel.`.
- Nhà cung cấp DNS ngoài danh sách hỗ trợ ban đầu cho DNS-01 (bắt đầu với Cloudflare).

## Acceptance criteria

1. Domain thử trỏ về IP .65: bắt đầu nhận ở `auth.hoandat.com/claim` sau khi đăng nhập; TXT đúng thì nhận được và người nhận là owner; có chứng chỉ hợp lệ cho `auth.`, `localman.`, `tunnel.` (HTTP-01) và `*.localman.`, `*.tunnel.` (DNS-01 bằng token của chủ domain); khai OAuth thì người dùng đăng nhập được ở cả ba app.
2. Hostname chưa nhận hoặc TXT sai: không tenant, không chứng chỉ, không trang đăng nhập, không app.
3. Cô lập: tài khoản, phiên, access/refresh/ID token, cookie, project, mock, tunnel của tenant A không dùng được ở tenant B (test tự động cho từng loại); token exchange chỉ trong cùng tenant.
4. Localman của tenant: tạo project, mock chạy qua `*.localman.<domain>` và `/m/<secret>`, MCP xác thực bằng `auth.<domain>`.
5. Tunelo của tenant: `tunelo login` trỏ tới `tunnel.<domain>` duyệt thiết bị trên `auth.<domain>`, mở tunnel ra `<sub>.tunnel.<domain>`, Localman của cùng tenant thấy tunnel đó.
6. Giao diện ba app hiển thị tên tenant; không còn "hoandat" cố định trong code chạy (`grep` kiểm cả hai repo, trừ cấu hình của tenant `hoandat.com`).
7. Tenant `hoandat.com` sau chuyển đổi: cùng issuer, cùng `kid`, Localman và Tunelo đăng nhập, refresh, token exchange, back-channel logout, audit chạy như trước; CLI đã cài không phải cấu hình lại; Config OP vẫn 38/38.
8. Vượt trần tenant hoặc tải: nhận domain mới bị từ chối có thông báo, tenant hiện có không bị ảnh hưởng.
9. Đủ cổng kiểm của cả hai repo (`hoandat-auth`: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens`; `localman-next`: `pnpm lint && pnpm typecheck && pnpm test && pnpm check:mcp-coverage` và e2e).

## Trade-offs

- **Mỗi app một process phục vụ mọi tenant (hướng chọn):** dựa nhiều nhất vào giả định số tenant nhỏ; hỏng đầu tiên khi nhiều tenant cùng hoạt động làm IdP vượt 400 MB hoặc Localman vượt 600 MB trên .65 ⟹ cần trần tenant và cache có giới hạn.
- **Một process cho mỗi tenant:** cô lập mạnh nhất, nhưng mỗi tenant tốn ba Node process; hỏng ngay trên .65 vì RAM.
- **Cô lập dữ liệu bằng `tenantId` hay database riêng:** database riêng rõ ràng hơn nhưng cần quyền tạo database (mongod chung của IdP, mongod riêng của Localman); `tenantId` không cần đổi quyền nhưng mọi truy vấn và chỉ mục phải mang nó, quên một chỗ là rò dữ liệu. Plan phải chọn và có test chặn rò.
- **DNS-01 bằng token của chủ domain:** đủ wildcard, nhưng mình giữ một token có quyền sửa DNS của họ; lộ token là sự cố của chủ domain. Phương án nhẹ hơn (mock chỉ theo đường dẫn, chỉ tunnel cần token) đã bị loại.

## Better approaches

- Jev khuyên máy riêng (0.94) để tách rủi ro lạm dụng và nginx catch-all khỏi các app trên .65. User đã chọn .65; plan giữ đường lùi chuyển máy không đổi code.

## Câu hỏi còn mở cho bước plan

- Cô lập dữ liệu: `tenantId` hay database riêng, cho từng app.
- Bot Telegram, Turnstile, VAPID theo tenant (tenant tự khai) hay chỉ tenant `hoandat.com` có.
- Trần số tenant và RAM cụ thể trên .65.
- Công cụ cấp chứng chỉ (HTTP-01 và DNS-01) và cách nginx dùng chung nạp server block mới an toàn.
- Cách CLI Tunelo chọn server của tenant mà không phá CLI đã cài.
- Thứ tự phase giữa hai repo và cách chuyển tenant `hoandat.com` mà không gián đoạn.
