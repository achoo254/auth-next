# hoandat-auth

IdP OpenID Connect tự host tại `auth.hoandat.com`: một nơi đăng nhập cho Localman web, Localman MCP, Tunelo CLI và Tunelo web. Dựng trên [`oidc-provider`](https://github.com/panva/node-oidc-provider) v9, Express 5 và MongoDB. Lý do chọn kiến trúc: [`docs/decisions/0001-own-oidc-idp.md`](docs/decisions/0001-own-oidc-idp.md); tài khoản và trang đăng nhập: [`docs/decisions/0002-accounts-and-login-pages.md`](docs/decisions/0002-accounts-and-login-pages.md).

Trạng thái: phase 02. Có lõi OIDC (phase 01) cùng trang đăng nhập, đăng ký, consent, duyệt thiết bị, quên mật khẩu, đăng xuất và trang `/account`. Không gửi email ở bất kỳ đâu.

## Bắt đầu

Yêu cầu: Node ≥ 22.12, pnpm 11, MongoDB (replica set) hoặc Docker.

```bash
pnpm install
pnpm generate-key            # tạo secrets/signing-keys.json (ES256, có kid)
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
| `pnpm generate-key [file]` | Sinh khoá ES256 và thêm vào cuối JWKS (chỉ để xác minh, xem ADR về xoay khoá) |

## Endpoint

Client phải đọc endpoint từ `/.well-known/openid-configuration`, không hardcode. Hiện tại: `/auth`, `/request` (PAR), `/token`, `/me` (userinfo), `/jwks`, `/device/auth` và `/device` (device flow), `/token/revocation`, `/token/introspection`, `/session/end`, `/reg` (DCR). `/auth`, `/request`, `/token`, `/device`, `/device/auth` và `/reg` bị giới hạn tần suất theo IP (mọi cách viết hoa/thường và `/` cuối đều tính chung). `/healthz` trả 200 khi process sống.

## Client và audience

| Client | Loại | Grant | Scope | Audience của access token |
|---|---|---|---|---|
| `localman-web` | confidential | Code + PKCE, refresh | `openid profile email offline_access` + scope API Localman | `https://localman.hoandat.com` |
| `tunelo-cli` | public | device code, refresh | `openid offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` |
| `tunelo-web` | confidential | Code + PKCE, refresh | `openid profile email offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` |
| Client MCP (DCR) | public hoặc confidential | Code + PKCE, refresh | chỉ `mock:read mock:write client:read client:write client:send` | luôn `https://localman.hoandat.com/mcp` |
| `hoandat-account` | public, nội bộ | Code + PKCE (code không bao giờ được đổi) | `openid` | không có |

`hoandat-account` là client riêng của trang `/account`: chưa đăng nhập thì `/account` gửi trình duyệt qua một authorization request bình thường của client này, nên đăng nhập dùng chung trang và chung cơ chế khoá; sau đó chỉ cookie phiên của IdP có ý nghĩa. App bên ngoài không dùng client này.

Access token là JWT ES256 (`typ: at+jwt`) sống 15 phút. App xác minh offline bằng `jose` với JWKS đã cache, kiểm `iss`, `aud` của chính mình, `alg: ES256` và `typ`; mẫu tham chiếu: [`src/__tests__/helpers/verify-access-token.ts`](src/__tests__/helpers/verify-access-token.ts).

Khi request không có `resource`, IdP chỉ gắn audience nếu scope xin có ít nhất một scope của resource duy nhất mà client được phép (ví dụ `mock:read` cho Localman, `tunnels:read` cho Tunelo). Request chỉ có `openid profile email` nhận access token opaque, dùng được cho userinfo (`/me`).

### Lưu ý cho client
- **Refresh token dùng một lần và xoay vòng.** Mỗi lần refresh trả về refresh token mới; dùng lại token cũ sẽ thu hồi cả grant. Hai request refresh song song với cùng một token thì chỉ một cái thắng, cái còn lại nhận `invalid_grant`. Vì vậy client (đặc biệt Tunelo CLI chạy nhiều tiến trình) **phải khoá khi refresh** (file lock hoặc mutex) và lưu token mới trước khi nhả khoá.
- **Phiên trượt, trần 90 ngày.** Mỗi lần refresh thành công, grant (và refresh token mới) được gia hạn thêm 30 ngày tính từ lúc refresh, nhưng không bao giờ quá 90 ngày kể từ lúc đăng nhập. Bỏ không refresh quá 30 ngày thì phiên hết hạn; tới ngày thứ 90 thì dù đang dùng cũng phải đăng nhập lại (`tunelo login`, hoặc đăng nhập lại ở app web). Refresh token gần trần chỉ sống tới đúng trần. Áp cho mọi grant có refresh token. Riêng client MCP (không có `offline_access`) thì refresh token còn gắn với phiên trình duyệt ở IdP, nên vẫn hết khi phiên đó hết.
- `offline_access` chỉ có hiệu lực khi request kèm `prompt=consent` (OIDC Core).
- Introspection: client chỉ xem được token của chính mình; riêng `localman-web` và `tunelo-web` xem được mọi token. Token không được phép xem trả `{"active": false}`.

Tunelo CLI nên gửi thêm `device_name=<hostname>` (tối đa 64 ký tự chữ, số, khoảng trắng, `._'()-`) trong request tới `/device/auth`; trang duyệt hiện "Cho phép `tunelo` trên máy <device_name>?" và trang `/account` liệt kê máy theo tên đó. Thiếu thì IdP dùng User-Agent.

Client MCP đăng ký qua `/reg`: redirect chỉ được là `https://…` hoặc `http://localhost`/`http://127.0.0.1`; xin resource khác `/mcp` bị trả `invalid_target`. `client_name` chứa `localman`, `tunelo` hoặc `hoandat` (không phân biệt hoa thường) bị từ chối, và client không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP đăng ký tối đa 20 client mỗi giờ.

## Tài khoản và đăng nhập

Mọi trang là HTML render phía server, không có JavaScript (CSP `script-src 'self'`, `style-src 'self'`), dùng token màu của Localman (`static/css/tokens.css`, bản sao có chủ đích) và font Inter, JetBrains Mono tự host từ `@fontsource` (có subset tiếng Việt). Mọi dữ liệu đưa vào HTML đi qua template tự escape (`src/ui/html.ts`).

| Đường dẫn | Việc |
|---|---|
| `/interaction/:uid` | Đăng nhập, đăng ký, consent, duyệt thiết bị, quên mật khẩu, Google/GitHub. Gắn với cookie interaction của `oidc-provider` |
| `/device` | Nhập mã thiết bị (trang của `oidc-provider` đã thay giao diện) |
| `/session/end` | Đăng xuất (trang của `oidc-provider` đã thay giao diện) |
| `/account` | Hồ sơ, đổi mật khẩu, mã khôi phục, liên kết Google/GitHub/Telegram, phiên đang mở, thiết bị Tunelo, ứng dụng đã cấp quyền |
| `/reset/:token` | Đặt mật khẩu mới từ link Telegram hoặc từ Google/GitHub đã liên kết; dùng một lần, sống 15 phút. Token nằm trong path: log của reverse proxy/CDN phải bỏ path `/reset/` (IdP đã tự che nó trong log lỗi) |
| `/oauth/:provider/callback` | Redirect URI đăng ký với Google/GitHub |
| `/telegram/webhook` | Webhook của bot; từ chối (401) khi header `X-Telegram-Bot-Api-Secret-Token` sai |

- **Đăng ký** bằng email, username (`^[a-z0-9_]{3,30}$`) và mật khẩu ≥ 7 ký tự (argon2id). Email và username luôn được chuẩn hoá (bỏ khoảng trắng, chữ thường). Ngay sau đó hiện 8 mã khôi phục `xxxx-xxxx` đúng một lần, có nút tải `.txt`; chỉ khi đánh dấu "đã lưu" thì đăng nhập mới hoàn tất. Email gõ tay luôn **chưa xác minh**; `email_verified` chỉ `true` khi Google hoặc GitHub xác minh.
- **Google/GitHub** (tuỳ chọn, theo env), qua `openid-client`: cả hai dùng Code + PKCE + state; Google thêm `nonce` và kiểm ID token (issuer, audience, hạn, nonce). Metadata của hai provider ghi tĩnh trong code, không gọi discovery. Luật liên kết: tài khoản provider đã liên kết thì đăng nhập; email trùng một tài khoản mà email đó đã được provider xác minh thì tự liên kết; email trùng một tài khoản mà email đó **chưa** xác minh thì không liên kết: người vừa chứng minh sở hữu email tạo tài khoản mới với email đó, còn tài khoản cũ bị gỡ email (vẫn đăng nhập bằng username, thấy thông báo ở `/account` và trên Telegram nếu đã liên kết); chưa có tài khoản thì tạo mới và hỏi username. Huỷ liên kết provider đã xác minh email thì email trở về chưa xác minh, trừ khi provider còn lại cũng đã xác minh đúng email đó. `/account` luôn hiện email/login mà provider báo lúc liên kết ("không rõ" với liên kết cũ). Provider không trả email đã xác minh thì bị từ chối.
- **Quên mật khẩu**, 3 đường, không đường nào dùng email: mã khôi phục (mỗi mã một lần), link qua bot Telegram đã liên kết (tối đa 3 lần mỗi 15 phút), hoặc đăng nhập Google/GitHub đã liên kết rồi đặt mật khẩu mới. Đặt lại mật khẩu xong thì **mọi** phiên trình duyệt khác và mọi grant (thiết bị Tunelo, ứng dụng, client MCP) của tài khoản bị thu hồi. Mọi mã/link một lần đang chờ của tài khoản (kể cả mã liên kết Telegram) cũng bị huỷ. Tổng quát hơn: mọi token một lần gắn với tài khoản mang `securityVersion` của lúc cấp (và kênh đã gửi: chat Telegram, tài khoản Google/GitHub); bất kỳ thay đổi bảo mật nào (mật khẩu, mã khôi phục, liên kết/gỡ phương thức, rà soát) làm chúng hết hiệu lực (410), xem ADR 0002 mục 10. Trong lúc chờ rà soát, IdP không gửi link reset qua Telegram hay Google/GitHub. Sau đó lần đăng nhập kế tiếp (hoặc ngay luồng mã khôi phục) dừng ở trang **Rà soát bảo mật** bắt buộc: liệt kê Google/GitHub đã liên kết (kèm email/login provider), chat Telegram, thời điểm tạo bộ mã khôi phục, mỗi mục có nút gỡ; chỉ khi bấm "Tôi đã rà soát" đăng nhập mới hoàn tất. Trình duyệt vừa đặt mật khẩu qua link (Telegram, Google/GitHub) được đưa thẳng vào trang rà soát; ở nơi khác, chỉ đăng nhập bằng mật khẩu mới mới vào được trang đó. Trong lúc chờ rà soát, không có đăng nhập ngầm nào, `/account` không mở được, và đăng nhập Google/GitHub bị từ chối với thông báo "Tài khoản vừa được đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới để rà soát bảo mật."
- **Telegram**: `/account` tạo deep link `t.me/<bot>?start=<code>` (dùng một lần, 10 phút); bot nhận `/start <code>`, hỏi lại kèm nút "Xác nhận liên kết", và chỉ gắn chat khi nút được bấm và phiên đã tạo mã vẫn còn. `/account` hiện @username và tên Telegram đã liên kết; khi chuyển sang chat khác thì chat cũ được báo. Bot báo cho chủ tài khoản khi đổi/đặt lại mật khẩu, tạo mã khôi phục mới, liên kết Google/GitHub, hoặc khi email bị gỡ.
- **Thao tác nhạy cảm ở `/account`** (đổi/đặt mật khẩu, tạo lại mã khôi phục, liên kết hoặc huỷ Google/GitHub/Telegram) cần đăng nhập trong 10 phút gần đây; quá hạn thì IdP hỏi lại mật khẩu (`prompt=login`) rồi đưa về `/account` để làm lại. Đổi mật khẩu luôn đăng xuất mọi trình duyệt khác; ô "Đăng xuất khỏi mọi thiết bị và ứng dụng" (bật sẵn) thu hồi luôn mọi grant.
- **Consent**: app first-party (`localman-web`, `tunelo-web`) không hỏi. Client MCP đăng ký qua DCR luôn hỏi, gắn nhãn "Ứng dụng bên thứ ba chưa xác minh" và hiện host của redirect URI. Đăng nhập Tunelo CLI luôn hỏi "Cho phép `tunelo` trên máy …?"; đã có phiên thì không hỏi mật khẩu. Mỗi máy có grant riêng nên thu hồi từng máy được.
- **Chống dò và đoán mật khẩu**: mọi form có CSRF (HMAC của một bí mật theo trình duyệt và phạm vi: uid interaction, uid phiên IdP hoặc token reset). Rate-limit theo IP cho mọi POST và cho bước bắt đầu đăng nhập Google/GitHub. Mỗi lượt thử mật khẩu hay mã khôi phục được giữ chỗ nguyên tử trong MongoDB **trước** khi chạy argon2, nên request song song cũng chỉ có tối đa 5 lượt được kiểm; sai đủ 5 lượt thì khoá 15 phút (có TTL, không mất khi restart). Bộ đếm theo tài khoản (username và email của một tài khoản dùng chung) hoặc theo định danh nếu tài khoản không tồn tại, cộng một bộ đếm theo IP (IPv6 gom theo /64). Trình duyệt từng đăng nhập thành công tài khoản (cookie thiết bị đã ký, HttpOnly) không dùng ngân sách của tài khoản mà có 5 lượt riêng theo từng cookie (hết thì cookie đó mất quyền miễn), nên người ngoài đoán mật khẩu không khoá được chủ tài khoản; đặt/đổi mật khẩu làm mọi cookie cũ mất hiệu lực. Đăng nhập sai và tài khoản không tồn tại trả cùng thông báo, cùng thời gian (luôn chạy argon2). Riêng trang đăng ký buộc phải nói trường nào đã được dùng (email hay username), vì không có mail để xác nhận.
- **Thu hồi** ở `/account`: thu hồi phiên (kèm back-channel logout như khi đăng xuất), thiết bị Tunelo hoặc ứng dụng. Thu hồi grant xoá refresh token, access token opaque và code của grant đó ngay; access token JWT không gọi lại được và hết hạn trong tối đa 15 phút.

## Cấu hình

Xem [`.env.example`](.env.example); env sai hoặc thiếu thì process báo tên biến và thoát với mã 1 (không in giá trị).

Ở production (`NODE_ENV=production`) process từ chối khởi động nếu `ISSUER`, `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL` không phải URL https công khai ghi rõ (không localhost), hoặc `TRUST_PROXY` vẫn là mặc định `loopback` hay `false`. `TRUST_PROXY` phải liệt kê **đúng địa chỉ** mà reverse proxy kết nối tới container (ví dụ IP của proxy trong mạng Docker) cùng từ khoá `cloudflare`, ví dụ `172.18.0.2,cloudflare`; đừng tin cả một dải mạng riêng, vì container nào trong dải đó cũng giả được IP client. File khoá mount read-only và phải đọc được bởi user `node` (uid 1000) trong container.

Google, GitHub và bot Telegram là tuỳ chọn: thiếu biến nào trong một nhóm thì process báo lỗi; bỏ trống cả nhóm thì nút tương ứng bị ẩn và route trả 404. Callback cần đăng ký ở Google/GitHub là `${ISSUER}/oauth/google/callback` và `${ISSUER}/oauth/github/callback`; webhook Telegram là `${ISSUER}/telegram/webhook` với `secret_token` bằng `TELEGRAM_WEBHOOK_SECRET`.

Request có Host khác host của `ISSUER` bị trả 421; thêm host phụ cho dev qua `ALLOWED_HOSTS`. Riêng `/healthz` trả lời mọi Host để healthcheck của container chạy được.

## Cấu trúc

```
src/server.ts                 # entry: env, Mongo, khoá ký, provider, dịch vụ, listen, tắt êm
src/app.ts                    # Express: bảo mật, /healthz, /assets, trang, provider
src/services.ts               # gom repository, CSRF, throttle, Google/GitHub, bot Telegram
src/config/                   # env (zod), env tích hợp, trust proxy (gồm dải IP Cloudflare)
src/http/                     # helmet + rate limit + header proxy, CSRF, đọc form, error handler
src/oidc/                     # cấu hình oidc-provider, client, resource, DCR, adapter Mongo, JWKS, claim
src/accounts/                 # model tài khoản, argon2id, mã khôi phục, khoá đăng nhập, token dùng một lần,
                              # luật liên kết, Google/GitHub qua openid-client
src/telegram/                 # bot client, deep link liên kết, webhook, link reset mật khẩu
src/interactions/             # trang đăng nhập, đăng ký, consent, thiết bị, quên mật khẩu, reset, logout, lỗi
src/account-portal/           # /account: phiên, grant, thiết bị, ứng dụng
src/ui/                       # template HTML tự escape, layout, component
static/css/                   # tokens.css (bản sao từ Localman) và app.css
src/__tests__/                # test luồng bằng openid-client trên Mongo thật, upstream giả
e2e/                          # Playwright trên server thật (e2e/support/e2e-server.ts)
```
