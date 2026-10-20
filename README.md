# hoandat-auth

IdP OpenID Connect tự host tại `auth.hoandat.com`: một nơi đăng nhập cho Localman web, Localman MCP, Tunelo CLI và Tunelo web. Dựng trên [`oidc-provider`](https://github.com/panva/node-oidc-provider) v9, Express 5 và MongoDB. Lý do chọn kiến trúc: [`docs/decisions/0001-own-oidc-idp.md`](docs/decisions/0001-own-oidc-idp.md); tài khoản và trang đăng nhập: [`docs/decisions/0002-accounts-and-login-pages.md`](docs/decisions/0002-accounts-and-login-pages.md); token exchange, kiểm client và audit: [`docs/decisions/0003-token-exchange-and-audit-outbox.md`](docs/decisions/0003-token-exchange-and-audit-outbox.md); chỉ đăng nhập bằng Google/GitHub: [`docs/decisions/0004-upstream-only-sign-in.md`](docs/decisions/0004-upstream-only-sign-in.md), thêm Apple: [`docs/decisions/0008-sign-in-with-apple.md`](docs/decisions/0008-sign-in-with-apple.md). **App tích hợp đọc [`docs/integration-guide.md`](docs/integration-guide.md).**

Trạng thái: phase 03 (phần IdP). Có lõi OIDC (phase 01), trang đăng nhập, đăng ký, consent, duyệt thiết bị, đăng xuất, trang `/account` (phase 02), cùng token exchange Localman → Tunelo, script kiểm client và outbox sự kiện audit gửi sang Localman (phase 03). Đăng nhập và đăng ký chỉ bằng Google, GitHub hoặc Apple (Apple khi đã cấu hình, ADR 0008): không có mật khẩu, mã khôi phục hay quên mật khẩu (ADR 0004). Không gửi email ở bất kỳ đâu.

## Ứng dụng đang đăng nhập qua `auth.hoandat.com`

Người dùng xem danh sách này ở trang công khai `/apps` (mở `auth.hoandat.com` cũng được chuyển tới đó), ba ngôn ngữ, render ở `src/app-directory/apps-page.ts`.

| Ứng dụng | Địa chỉ | `client_id` | Cách đăng nhập |
|---|---|---|---|
| Localman web | `https://localman.hoandat.com` | `localman-web` | Nút đăng nhập trên web (Code + PKCE); phiên gắn với phiên IdP, đăng xuất ở IdP là đăng xuất Localman |
| Localman MCP | `https://localman.hoandat.com/mcp` | mỗi client MCP một id (DCR) | Client MCP (ví dụ Claude Code) tự đăng ký qua `/reg`, người dùng duyệt quyền ở trang consent |
| Tunelo CLI | lệnh `tunelo` trên máy người dùng | `tunelo-cli` | `tunelo login` (device flow): mở `/device`, nhập mã, duyệt từng máy |
| Tunelo web | `https://tunnel.hoandat.com` | `tunelo-web` | Nút đăng nhập trên web (Code + PKCE) |
| Chat web (repo `chat-next`) | `https://chat.hoandat.com` | `chat-web` | Nút đăng nhập trên web (Code + PKCE); phiên gắn với phiên IdP |
| Chat mobile, desktop (repo `chat-next`) | app iOS/Android, macOS/Windows/Linux | `chat-mobile`, `chat-desktop` | Trình duyệt hệ thống, Code + PKCE; redirect private-use scheme (`CHAT_MOBILE_REDIRECT_URI`) hoặc loopback cổng bất kỳ |
| Trang tài khoản | `https://auth.hoandat.com/account` | `hoandat-account` | Nội bộ IdP, không dành cho app bên ngoài |

Địa chỉ trên là của production; môi trường khác đổi qua `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL`, `CHAT_WEB_URL`, `ISSUER`. Trang `/apps` chỉ liệt kê Chat ở tenant chính: tenant khác chưa có host `chat.<domain>`. Localman còn nhận sự kiện audit từ IdP (mục **Audit** bên dưới). Client tĩnh chỉ khai ở [`src/oidc/clients.ts`](src/oidc/clients.ts); thêm app mới thì khai ở đó rồi cập nhật bảng này, trang `/apps`, mục [Client và audience](#client-và-audience) và [`docs/integration-guide.md`](docs/integration-guide.md) mục 2.

## Domain riêng (tenant)

Từ 13/10/2026 IdP phục vụ cả các domain khác: chủ domain nhận domain ở `https://auth.hoandat.com/claim` (TXT + bản ghi A), khai OAuth Google/GitHub và token Cloudflare ở `https://auth.<domain>/admin`; người dùng của domain đăng nhập ở `auth.<domain>`, dùng `localman.<domain>` và `tunnel.<domain>`, dữ liệu tách hẳn hoandat.com. Hướng dẫn cho chủ domain: [`docs/tenant-owner-guide.md`](docs/tenant-owner-guide.md). Thiết kế: ADR [0006](docs/decisions/0006-tenants-by-domain.md). Vận hành (env, provisioner chứng chỉ, nginx): [`docs/deployment-guide.md`](docs/deployment-guide.md). Tenant đầu tiên: `inetdev.io.vn`.

## Bắt đầu

Yêu cầu: Node ≥ 22.12, pnpm 11, MongoDB (replica set) hoặc Docker.

```bash
pnpm install
pnpm generate-key            # tạo secrets/signing-keys.json (ES256, có kid)
pnpm generate-key secrets/signing-keys.json --alg RS256   # thêm khoá RSA cho ID token RS256
cp .env.example .env         # điền COOKIE_KEYS và hai client secret
pnpm dev                     # http://localhost:4500, cần MONGO_URL trỏ tới MongoDB
```

Hoặc chạy cả MongoDB lẫn IdP bằng Docker: `docker compose up --build` (cả hai cổng chỉ bind `127.0.0.1`).

| Lệnh | Việc |
|---|---|
| `pnpm dev` | Chạy server với `tsx watch`, đọc `.env` nếu có |
| `pnpm build` / `pnpm start` | Bundle `dist/server.mjs` bằng esbuild / chạy bản build |
| `pnpm lint` | Biome 1.9.4 |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (unit + integration HTTP); tự chạy một mongod thật qua `mongodb-memory-server` (lần đầu tải binary). Tối đa 2 worker (đặt trong `vitest.config.ts`); thêm tham số thì viết `pnpm test <args>`, vì `pnpm test -- <args>` không chuyển tham số |
| `pnpm test:e2e` | Playwright (Chromium, 1 worker) trên server thật ở cổng 4590/4591 với Google, GitHub, Telegram giả. Cài trình duyệt một lần: `pnpm exec playwright install chromium` |
| `pnpm check:tokens` | Không có mã màu (hex, `rgb()`, `hsl()`) trong `src/` và `static/` ngoài `static/css/tokens.css` |
| `pnpm generate-key [file] [--alg ES256\|RS256]` | Sinh khoá (mặc định ES256) và thêm vào cuối JWKS; khoá đầu tiên của mỗi thuật toán ký, khoá sau chỉ để xác minh (ADR 0001 mục 4, ADR 0005) |
| `pnpm conformance:idp` | Bản IdP thử cho bộ conformance OpenID (Basic OP): cấu hình provider thật trên MongoDB trong bộ nhớ, khoá ES256 + RS256 sinh tạm, đăng nhập tự hoàn tất bằng tài khoản thử; cần `CONFORMANCE_ISSUER` là URL https công khai (mở bằng `tunelo http 4595:<subdomain>`). Ghi cấu hình plan kèm secret thử vào `secrets/conformance-plan.json` (mode 600). Chỉ để kiểm thử, xem đầu `e2e/support/conformance-server.ts` |
| `pnpm seed:clients [--skip-discovery]` | Kiểm client tĩnh với env hiện tại (validator của `oidc-provider`, bản ghi MongoDB che id tĩnh, discovery và JWKS của issuer), in kế hoạch kèm fingerprint; chỉ đọc, chạy lại cho cùng kết quả. Trong image production: `node dist/seed-clients.mjs` |

## Endpoint

Client phải đọc endpoint từ `/.well-known/openid-configuration`, không hardcode. `prompt_values_supported` gồm `none`, `create`, `login`, `consent`: `prompt=create` (OIDC Prompt Create) mở thẳng trang đăng ký, đăng ký xong quay về client như đăng nhập. Hiện tại: `/auth`, `/request` (PAR), `/token`, `/me` (userinfo), `/jwks`, `/device/auth` và `/device` (device flow), `/token/revocation`, `/token/introspection`, `/session/end`, `/reg` (DCR). `/auth`, `/request`, `/token`, `/device`, `/device/auth` và `/reg` bị giới hạn tần suất theo IP (mọi cách viết hoa/thường và `/` cuối đều tính chung). `/healthz` trả 200 khi process sống.

## Client và audience

| Client | Loại | Grant | Scope | Audience của access token |
|---|---|---|---|---|
| `localman-web` | confidential | Code + PKCE, refresh (gắn phiên IdP), token exchange | `openid profile email telegram` + scope API Localman | `https://localman.hoandat.com`; token exchange cấp `https://tunnel.hoandat.com` |
| `tunelo-cli` | public | device code, refresh | `openid offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` |
| `tunelo-web` | confidential | Code + PKCE, refresh (gắn phiên IdP) | `openid profile email tunnels:open tunnels:read` | `https://tunnel.hoandat.com` (trang web Tunelo chỉ xin `openid profile`, nhận access token opaque cho userinfo) |
| `chat-web` | confidential | Code + PKCE, refresh (gắn phiên IdP) | `openid profile email` | không có (chat tự cấp phiên, chỉ đọc ID token và userinfo) |
| `chat-mobile`, `chat-desktop` | public, native | Code + PKCE, refresh (theo thiết bị) | `openid profile email` | không có |
| Client MCP (DCR) | public hoặc confidential | Code + PKCE, refresh | chỉ `mock:read mock:write client:read client:write client:send`, cộng `credentials:write` nếu khai rõ lúc đăng ký | luôn `https://localman.hoandat.com/mcp` |
| `hoandat-account` | public, nội bộ | Code + PKCE (code không bao giờ được đổi) | `openid` | không có |

Back-channel logout: `localman-web` tới `${LOCALMAN_WEB_URL}/auth/backchannel-logout`, `tunelo-web` tới `${TUNELO_WEB_URL}/auth/backchannel-logout`, `chat-web` tới `${CHAT_WEB_URL}/auth/backchannel-logout` (cả ba có `sid`).

**Token exchange** (RFC 8693, grant `urn:ietf:params:oauth:grant-type:token-exchange`): chỉ `localman-web`, đổi access token opaque của phiên Localman lấy JWT `aud=https://tunnel.hoandat.com`, `scope=tunnels:read`, sống 15 phút, có `act`/`azp` là `localman-web`, không có refresh token. Subject token phải còn sống (grant chưa bị thu hồi, tài khoản không bị khoá). Chi tiết và mã lỗi: [`docs/integration-guide.md`](docs/integration-guide.md) mục 6.

`hoandat-account` là client riêng của trang `/account`: chưa đăng nhập thì `/account` gửi trình duyệt qua một authorization request bình thường của client này, nên đăng nhập dùng chung trang và chung cơ chế khoá; sau đó chỉ cookie phiên của IdP có ý nghĩa. App bên ngoài không dùng client này.

ID token mặc định ký ES256; client tĩnh khai `id_token_signed_response_alg: "RS256"` thì nhận RS256 (discovery quảng bá cả hai, theo OpenID Connect Discovery; ADR 0005). Access token là JWT ES256 (`typ: at+jwt`) sống 15 phút. App xác minh offline bằng `jose` với JWKS đã cache, kiểm `iss`, `aud` của chính mình, `alg: ES256` và `typ`; mẫu tham chiếu: [`src/__tests__/helpers/verify-access-token.ts`](src/__tests__/helpers/verify-access-token.ts).

Scope `telegram` (chỉ `localman-web`, không hỏi consent vì là app first-party) trả `telegram_chat_id` và `telegram_username` của chat đã liên kết **chỉ qua userinfo**, không bao giờ trong ID token hay access token; chưa liên kết thì không có hai claim này (`telegram_linked` của scope `profile` vẫn như cũ). Localman dùng nó để gửi thông báo bằng bot riêng: [`docs/integration-guide.md`](docs/integration-guide.md) mục 4.

Khi request không có `resource`, IdP chỉ gắn audience nếu scope xin có ít nhất một scope của resource duy nhất mà client được phép (ví dụ `mock:read` cho Localman, `tunnels:read` cho Tunelo). Request chỉ có `openid profile email` nhận access token opaque, dùng được cho userinfo (`/me`).

### Lưu ý cho client
- **Refresh token dùng một lần và xoay vòng.** Mỗi lần refresh trả về refresh token mới; dùng lại token cũ sẽ thu hồi cả grant. Hai request refresh song song với cùng một token thì chỉ một cái thắng, cái còn lại nhận `invalid_grant`. Vì vậy client (đặc biệt Tunelo CLI chạy nhiều tiến trình) **phải khoá khi refresh** (file lock hoặc mutex) và lưu token mới trước khi nhả khoá.
- **Phiên trượt, trần 90 ngày.** Mỗi lần refresh thành công, grant (và refresh token mới) được gia hạn thêm 30 ngày tính từ lúc refresh, nhưng không bao giờ quá 90 ngày kể từ lúc đăng nhập. Bỏ không refresh quá 30 ngày thì phiên hết hạn; tới ngày thứ 90 thì dù đang dùng cũng phải đăng nhập lại ở app web. Refresh token gần trần chỉ sống tới đúng trần. Áp cho mọi grant có refresh token, **trừ thiết bị Tunelo CLI và app chat native** (`tunelo-cli`, Jev 0.98): máy chạy liên tục (server lab) cứ refresh là còn phiên, không có trần 90 ngày; máy bỏ quá 30 ngày vẫn hết hạn, và mỗi thiết bị thu hồi được ở `/account` (`hasHardCap` trong `src/oidc/sliding-grants.ts`). `chat-mobile`, `chat-desktop` cũng vậy, và nhận refresh token không cần `offline_access`; refresh token của chúng không chết khi người dùng đăng xuất trên trình duyệt (`refreshesPerDevice`). Riêng `localman-web` và client MCP (không có `offline_access`) thì refresh token còn gắn với phiên trình duyệt ở IdP: đăng xuất ở IdP thu hồi grant của chúng, kể cả token exchange của Localman (Jev 0.94).
- `offline_access` chỉ có hiệu lực khi request kèm `prompt=consent` (OIDC Core); chỉ `tunelo-cli` có scope này. `tunelo-web` (trang web Tunelo) và `chat-web`, như `localman-web`, có refresh token gắn với phiên IdP: đăng xuất ở IdP thì lần refresh sau của nó nhận `invalid_grant`, kể cả khi back-channel logout không tới.
- Revocation: client chỉ thu hồi được token của chính nó.
- Introspection: client chỉ xem được token của chính mình; riêng `localman-web` và `tunelo-web` xem được mọi token. Token không được phép xem trả `{"active": false}`.

Tunelo CLI nên gửi thêm `device_name=<hostname>` (tối đa 64 ký tự chữ, số, khoảng trắng, `._'()-`) trong request tới `/device/auth`; trang duyệt hiện "Cho phép `tunelo` trên máy <device_name>?" và trang `/account` liệt kê máy theo tên đó. Thiếu thì IdP dùng User-Agent. App native theo thiết bị (`chat-mobile`, `chat-desktop`, `scribe-mobile`) gửi được cùng tham số `device_name` trong authorization request; mỗi lần duyệt là một grant riêng cho máy đó.

Client MCP đăng ký qua `/reg`: redirect chỉ được là `https://…` hoặc `http://localhost`/`http://127.0.0.1`; xin resource khác `/mcp` bị trả `invalid_target`. `client_name` là tên tự khai: chỉ bị từ chối khi rỗng, dài quá 100 ký tự hoặc chứa ký tự điều khiển/bidi; tên chứa `localman`, `tunelo`, `hoandat` (như `Claude Code (localman)`) hay bản nhái vẫn đăng ký được, còn trang consent cảnh báo mạo danh (xem dưới). Client không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP đăng ký tối đa 20 client mỗi giờ.

## Tài khoản và đăng nhập

Mọi trang có ba ngôn ngữ: English (mặc định), 中文 giản thể và Tiếng Việt. Chữ người dùng thấy nằm trong từ điển có kiểu ở `src/i18n/messages/{en,zh-cn,vi}/` (thiếu key là lỗi typecheck); trang chọn ngôn ngữ theo `ui_locales` của app, cookie `hd_lang`, `Accept-Language`, rồi English. Ngày giờ định dạng theo ngôn ngữ, múi `Asia/Ho_Chi_Minh`.

Mọi trang là HTML render phía server, không có JavaScript (CSP `script-src 'self'`, `style-src 'self'`), dùng token màu của Localman (`static/css/tokens.css`, bản sao có chủ đích) và font Inter, JetBrains Mono tự host từ `@fontsource` (có subset tiếng Việt). Mọi dữ liệu đưa vào HTML đi qua template tự escape (`src/ui/html.ts`).

| Đường dẫn | Việc |
|---|---|
| `/apps` | Trang công khai liệt kê ứng dụng đăng nhập qua IdP, địa chỉ lấy từ `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL`, `CHAT_WEB_URL` (Chat chỉ ở tenant chính), `ISSUER`; `/` chuyển hướng (302) tới đây |
| `/interaction/:uid` | Đăng nhập và đăng ký bằng Google/GitHub, consent, duyệt thiết bị. Gắn với cookie interaction của `oidc-provider` |
| `/device` | Nhập mã thiết bị (trang của `oidc-provider` đã thay giao diện) |
| `/session/end` | Đăng xuất (trang của `oidc-provider` đã thay giao diện) |
| `/account` | Ba nhóm card: Tài khoản (hồ sơ, cách đăng nhập), Bảo mật (phiên đang mở, thiết bị: Tunelo CLI và app native `chat-mobile`, `chat-desktop`, `scribe-mobile`, mỗi máy một dòng), Kết nối (ứng dụng đã cấp quyền, Telegram) |
| `/account/apps/:clientId/revoke`, `/account/sessions/revoke-others` | Trang xác nhận (GET) trước khi gỡ quyền ứng dụng hoặc đăng xuất mọi phiên khác; POST cần CSRF và đăng nhập gần đây |
| `/account/delete` | Xoá tài khoản (chỉ tenant chính, ADR 0009): trang xác nhận (GET), POST cần CSRF, đăng nhập gần đây và gõ lại username |
| `/lang?set=<locale>&return=<path>` | Nút chuyển ngôn ngữ (English, 中文, Tiếng Việt), xem `docs/integration-guide.md` mục 4 |
| `/oauth/:provider/callback` | Redirect URI đăng ký với Google/GitHub/Apple. Apple trả về bằng `POST` (form_post): IdP cất câu trả lời 2 phút theo state rồi 303 sang `GET` cùng path, nơi kiểm cookie state |
| `POST /oauth/apple/notifications` | Thông báo server-to-server của Apple (JWS, kiểm chữ ký): `consent-revoked`, `account-deleted` bỏ token thu hồi đã lưu |
| `/telegram/webhook` | Webhook của bot; từ chối (401) khi header `X-Telegram-Bot-Api-Secret-Token` sai |

- **Đăng nhập và đăng ký** chỉ bằng Google hoặc GitHub. Trang đăng nhập chỉ có hai nút "Đăng nhập với Google/GitHub" và nút huỷ; `prompt=create` mở trang đăng ký với cùng hai nút ("Đăng ký với …"). Danh tính Google/GitHub chưa liên kết với tài khoản nào thì tạo tài khoản mới sau khi chọn username (`^[a-z0-9_]{3,30}$`); email của tài khoản mới luôn là email provider đã xác minh. Không có đăng nhập, đăng ký hay đặt lại bằng mật khẩu; các route cũ (`POST /interaction/:uid/login`, `/signup`, `/forgot/*`, `/reset/*`, đổi mật khẩu và mã khôi phục ở `/account`) trả 404. Bản băm mật khẩu và mã khôi phục của tài khoản cũ vẫn nằm trong MongoDB nhưng không bao giờ được đọc. Chưa cấu hình Google lẫn GitHub thì trang đăng nhập trả 503 với thông báo thay cho các nút.
- **Google/GitHub** (theo env; phải bật ít nhất một), qua `openid-client`: cả hai dùng Code + PKCE + state; Google thêm `nonce` và kiểm ID token (issuer, audience, hạn, nonce). Metadata của hai provider ghi tĩnh trong code, không gọi discovery. Luật liên kết: tài khoản provider đã liên kết thì đăng nhập; email trùng một tài khoản mà email đó đã được provider xác minh thì tự liên kết; email trùng một tài khoản mà email đó **chưa** xác minh thì không liên kết: người vừa chứng minh sở hữu email tạo tài khoản mới với email đó, còn tài khoản cũ bị gỡ email (giữ các Google/GitHub khác đã liên kết, thấy thông báo ở `/account` và trên Telegram nếu đã liên kết); chưa có tài khoản thì tạo mới và hỏi username. Huỷ liên kết provider đã xác minh email thì email trở về chưa xác minh, trừ khi provider còn lại cũng đã xác minh đúng email đó. `/account` luôn hiện email/login mà provider báo lúc liên kết ("không rõ" với liên kết cũ). Provider không trả email đã xác minh thì bị từ chối.
- **Cách đăng nhập** ở `/account` (neo `#account-sign-in`): liên kết và huỷ liên kết Google/GitHub. Không huỷ được provider cuối cùng còn đăng nhập được (đã liên kết và đang bật ở IdP); lệnh ghi ở MongoDB còn đòi provider kia vẫn liên kết, nên hai lần huỷ song song cũng không để tài khoản mất cách vào. Nên liên kết cả hai: mất một tài khoản Google/GitHub thì vẫn vào bằng cái kia. Mọi token một lần gắn với tài khoản (mã liên kết Telegram, liên kết Google/GitHub dở dang) mang `securityVersion` của lúc cấp; liên kết/gỡ phương thức hay email bị lấy lại làm chúng hết hiệu lực (410), xem ADR 0002 mục 10.
- **Telegram**: `/account` tạo deep link `t.me/<bot>?start=<code>` (dùng một lần, 10 phút); bot nhận `/start <code>`, hỏi lại kèm nút xác nhận ("Confirm link", "确认关联", "Xác nhận liên kết"), và chỉ gắn chat khi nút được bấm và phiên đã tạo mã vẫn còn. `/account` hiện @username và tên Telegram đã liên kết; khi chuyển sang chat khác thì chat cũ được báo. Telegram chỉ để nhận thông báo, không dùng để đăng nhập; bot báo cho chủ tài khoản khi có Google/GitHub mới được liên kết hoặc khi email bị gỡ.
- **Ngôn ngữ của bot**: mã liên kết mang ngôn ngữ của trang `/account` đã tạo nó; bot hỏi và báo kết quả bằng ngôn ngữ đó, và khi liên kết xong thì lưu nó vào `telegramLocale` của tài khoản. Mỗi lần mở `/account` bằng ngôn ngữ khác trong lúc đang liên kết thì `telegramLocale` đổi theo (không tăng `securityVersion`). Thông báo bảo mật dùng `telegramLocale`, không có thì English. Tin trả lời chat chưa gắn với mã còn hiệu lực (`/start` không kèm mã, mã đã dùng/hết hạn) theo `language_code` của Telegram: `zh`, `zh-hans`, `zh-cn` là 中文, `vi*` là Tiếng Việt, còn lại English.
- **Thao tác nhạy cảm ở `/account`** (liên kết hoặc huỷ Google/GitHub/Telegram, gỡ quyền ứng dụng, đăng xuất mọi phiên khác) cần đăng nhập trong 10 phút gần đây; quá hạn thì IdP bắt đăng nhập lại bằng Google/GitHub (`prompt=login`) rồi đưa về `/account` để làm lại.
- **Consent**: app first-party (`localman-web`, `tunelo-web`) không hỏi. Client MCP đăng ký qua DCR luôn hỏi: tên trong ngoặc kép, nhãn "Ứng dụng bên ngoài" kèm cảnh báo "không do hoandat.com phát hành", cảnh báo đỏ nếu tên giống sản phẩm hoandat, và host của `redirect_uri` của lần này. Đăng nhập Tunelo CLI luôn hỏi "Cho phép `tunelo` trên máy …?"; đã có phiên thì không phải đăng nhập lại. Mỗi máy có grant riêng nên thu hồi từng máy được.
- **Chống giả mạo form**: mọi form có CSRF (HMAC của một bí mật theo trình duyệt và phạm vi: uid interaction hoặc uid phiên IdP). Rate-limit theo IP cho mọi POST và cho bước bắt đầu đăng nhập Google/GitHub.
- **Thu hồi** ở `/account`, nút ghi rõ tác dụng: "Sign out this browser" (phiên hiện tại, có badge), "Sign out session", "Sign out device", "Remove app access" (nút đỏ duy nhất) và "Sign out every other session" khi có từ hai phiên. Gỡ quyền ứng dụng và đăng xuất mọi phiên khác hỏi lại ở trang riêng; đăng xuất phiên đi kèm back-channel logout như khi đăng xuất. Thu hồi grant xoá refresh token, access token opaque và code của grant đó ngay; access token JWT không gọi lại được và hết hạn trong tối đa 15 phút.

## Cấu hình

Xem [`.env.example`](.env.example); env sai hoặc thiếu thì process báo tên biến và thoát với mã 1 (không in giá trị).

Ở production (`NODE_ENV=production`) process từ chối khởi động nếu `ISSUER`, `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL` không phải URL https công khai ghi rõ (không localhost), hoặc `TRUST_PROXY` vẫn là mặc định `loopback` hay `false`. `TRUST_PROXY` phải liệt kê **đúng địa chỉ** mà reverse proxy kết nối tới container (ví dụ IP của proxy trong mạng Docker) cùng từ khoá `cloudflare`, ví dụ `172.18.0.2,cloudflare`; đừng tin cả một dải mạng riêng, vì container nào trong dải đó cũng giả được IP client. File khoá mount read-only và phải đọc được bởi user `node` (uid 1000) trong container.

Google, GitHub và bot Telegram cấu hình theo nhóm: thiếu biến nào trong một nhóm thì process báo lỗi; bỏ trống cả nhóm thì nút tương ứng bị ẩn và route trả 404. Google và GitHub là cách đăng nhập duy nhất, nên bỏ trống cả hai thì không ai đăng nhập được (trang đăng nhập báo 503). Callback cần đăng ký ở Google/GitHub là `${ISSUER}/oauth/google/callback` và `${ISSUER}/oauth/github/callback`; Apple (bốn biến `APPLE_*`, khoá `.p8` trong `secrets/`, chỉ tenant chính) dùng `${ISSUER}/oauth/apple/callback`, các bước ở [`docs/sign-in-with-apple.md`](docs/sign-in-with-apple.md); webhook Telegram là `${ISSUER}/telegram/webhook` với `secret_token` bằng `TELEGRAM_WEBHOOK_SECRET`.

**Audit**: đăng nhập thành công, liên kết/gỡ Google/GitHub/Telegram, email bị lấy lại, duyệt thiết bị Tunelo, consent client MCP, thu hồi phiên/grant (cả ở `/token/revocation`) và đăng xuất RP-initiated được ghi vào collection `audit_outbox`, sau bước bảo mật tương ứng; ghi lỗi chỉ bị log, không làm hỏng bước đó. Đặt đủ `AUDIT_EVENTS_URL` (https, không chứa user:pass), `AUDIT_CLIENT_ID` (không chứa `:`), `AUDIT_CLIENT_SECRET` thì một dispatcher nền gửi từng sự kiện (cũ trước) sang Localman dạng SET ký ES256, `aud` là đúng URL đó, hết hạn 10 phút sau lúc ký (HTTP Basic `base64(id:secret)`, `Idempotency-Key`), thử lại 5 giây nhân đôi tới trần 1 giờ, không bỏ sự kiện nào; thiếu cả ba thì sự kiện nằm chờ. Sự kiện chờ quá 30 ngày bị xoá IP/User-Agent; sự kiện đã gửi tự xoá sau 30 ngày. Xoá tài khoản xoá ngay IP/User-Agent của mọi sự kiện của tài khoản đó và ghi `account.deleted`. Định dạng: [`docs/integration-guide.md`](docs/integration-guide.md) mục 10.

Request có Host khác host của `ISSUER` bị trả 421; thêm host phụ cho dev qua `ALLOWED_HOSTS`. Riêng `/healthz` trả lời mọi Host để healthcheck của container chạy được.

## Cấu trúc

```
src/server.ts                 # entry: env, Mongo, khoá ký, provider, dịch vụ, dispatcher audit, listen, tắt êm
src/app.ts                    # Express: bảo mật, /healthz, /assets, trang, provider
src/services.ts               # gom repository, CSRF, Google/GitHub, bot Telegram
src/config/                   # env (zod), env tích hợp, trust proxy (gồm dải IP Cloudflare)
src/http/                     # helmet + rate limit + header proxy, CSRF, đọc form, error handler
src/oidc/                     # cấu hình oidc-provider, client, resource, DCR, adapter Mongo, JWKS, claim,
                              # token exchange, kiểm client (seed)
src/audit/                    # sự kiện audit: outbox Mongo, ký SET, dispatcher gửi sang Localman
src/accounts/                 # model tài khoản, token dùng một lần,
                              # luật liên kết, Google/GitHub qua openid-client
src/telegram/                 # bot client, deep link liên kết, webhook, thông báo
src/app-directory/            # /apps: danh sách ứng dụng đăng nhập qua IdP
src/interactions/             # trang đăng nhập/đăng ký Google/GitHub, consent, thiết bị, logout, lỗi
src/account-portal/           # /account: phiên, grant, thiết bị, ứng dụng
src/i18n/                     # ngôn ngữ: chọn locale, từ điển en/zh-cn/vi, endpoint /lang
src/ui/                       # template HTML tự escape, layout, component, logo Google/GitHub
static/css/                   # tokens.css (bản sao từ Localman) và app.css
src/__tests__/                # test luồng bằng openid-client trên Mongo thật, upstream giả
e2e/                          # Playwright trên server thật (e2e/support/e2e-server.ts)
```
