# Hướng dẫn tích hợp với `auth.hoandat.com`

Tài liệu cho Localman web, Localman MCP, Chat MCP, Tunelo CLI, Tunelo web và Localman (nhận audit). Quyết định phía IdP: [ADR 0001](decisions/0001-own-oidc-idp.md), [ADR 0002](decisions/0002-accounts-and-login-pages.md), [ADR 0003](decisions/0003-token-exchange-and-audit-outbox.md), [ADR 0004](decisions/0004-upstream-only-sign-in.md) (chỉ đăng nhập bằng Google/GitHub), [ADR 0008](decisions/0008-sign-in-with-apple.md) (thêm Apple).

## 1. Endpoint: luôn lấy từ discovery

Issuer production là `https://auth.hoandat.com` (staging có issuer riêng; cấu hình bằng env của app, ví dụ `AUTH_ISSUER`). Mọi endpoint đọc từ `${issuer}/.well-known/openid-configuration`, **không hardcode đường dẫn**:

| Trường discovery | Dùng cho |
|---|---|
| `authorization_endpoint`, `token_endpoint` | Code + PKCE, refresh, token exchange |
| `device_authorization_endpoint` | Tunelo CLI (device flow) |
| `jwks_uri` | Xác minh access token, logout token, sự kiện audit |
| `revocation_endpoint` | `tunelo logout`, đăng xuất app |
| `end_session_endpoint` | RP-initiated logout |
| `registration_endpoint` | Client MCP tự đăng ký (DCR) |
| `userinfo_endpoint`, `introspection_endpoint` | Claim hồ sơ; introspection (ít dùng) |

```ts
import * as oidc from "openid-client";

const config = await oidc.discovery(
	new URL(process.env.AUTH_ISSUER ?? "https://auth.hoandat.com"),
	"localman-web",
	{},
	oidc.ClientSecretBasic(process.env.LOCALMAN_WEB_CLIENT_SECRET ?? ""),
);
// config.serverMetadata().token_endpoint, .jwks_uri, ...
```

## 2. Client, luồng, scope và `aud`

ID token mặc định ký **ES256**. Discovery quảng bá `id_token_signing_alg_values_supported: ["ES256", "RS256"]` (OpenID Connect Discovery bắt buộc RS256): app mới dùng thư viện chờ RS256 thì khai `id_token_signed_response_alg: "RS256"` trong client tĩnh của nó (`src/oidc/clients.ts`). Access token và sự kiện audit luôn ES256. Xác minh ID token bằng JWKS, chọn khoá theo `kid` (`jose` làm sẵn); JWKS có cả khoá EC và RSA (ADR 0005).

| `client_id` | Loại | Luồng | Scope được phép | `aud` của access token | Back-channel logout |
|---|---|---|---|---|---|
| `localman-web` | confidential (`client_secret_basic`) | Code + PKCE, refresh (gắn phiên IdP), **token exchange** | `openid profile email telegram` + scope API Localman (không có `offline_access`) | `https://localman.hoandat.com` (chỉ khi xin scope API); đổi được token `https://tunnel.hoandat.com` | `https://localman.hoandat.com/auth/backchannel-logout` |
| `tunelo-cli` | public (`none`) | Device flow, refresh | `openid offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` | không |
| `tunelo-web` | confidential (`client_secret_basic`) | Code + PKCE, refresh (gắn phiên IdP) | `openid profile email tunnels:open tunnels:read` (không có `offline_access`; trang web Tunelo xin `openid profile`) | `https://tunnel.hoandat.com` | `https://tunnel.hoandat.com/auth/backchannel-logout` |
| `chat-web` | confidential (`client_secret_basic`) | Code + PKCE, refresh (gắn phiên IdP) | `openid profile email` (không có `offline_access`) | không có: access token opaque chỉ dùng cho userinfo | `https://chat.hoandat.com/auth/backchannel-logout` |
| `chat-mobile` | public, native (`none`) | Code + PKCE qua trình duyệt hệ thống, refresh (theo thiết bị, mục 8) | `openid profile email` | không có | không |
| `scribe-web` (khi có `SCRIBE_WEB_CLIENT_SECRET`) | confidential (`client_secret_basic`) | Code + PKCE, refresh (gắn phiên IdP) | `openid profile email` | không có | `${SCRIBE_WEB_URL}/api/auth/backchannel-logout` |
| `scribe-mobile` | public, native (`none`) | Code + PKCE qua trình duyệt hệ thống, refresh (theo thiết bị, mục 8) | `openid profile email` | không có | không |
| `scribe-web-dev` (tuỳ chọn) | confidential (`client_secret_basic`) | Code + PKCE cho dev local, redirect loopback khớp đúng cổng | `openid profile email` | không có | không |
| `miu-web` (khi có `MIU_WEB_CLIENT_SECRET`) | confidential (`client_secret_basic`) | Code + PKCE, **không refresh** (chỉ `authorization_code`) | `openid email` | không có | `${MIU_WEB_URL}/api/auth/backchannel-logout` |
| `miu-mobile` | public, native (`none`) | Code + PKCE qua trình duyệt hệ thống, không refresh | `openid email` | không có | không |
| `miu-web-dev` (tuỳ chọn) | confidential (`client_secret_basic`) | Code + PKCE cho dev local, redirect loopback khớp đúng cổng, không refresh | `openid email` | không có | không |
| `tieude-web`, `tuvi-web`, `clip-web`, `webnhanh-web` (mỗi client khi có cả `<APP>_WEB_URL` và `<APP>_WEB_CLIENT_SECRET`, `<APP>` là `TIEUDE`, `TUVI`, `CLIP`, `WEBNHANH`) | confidential (`client_secret_basic`) | Code + PKCE, **không refresh** (chỉ `authorization_code`); redirect `${<APP>_WEB_URL}/auth/callback`, post-logout `${<APP>_WEB_URL}/` | `tieude-web`: `openid` (chỉ cần `sub`); ba client còn lại: `openid profile email` (tên, ảnh, email đọc ở userinfo cho menu tài khoản; không có trang consent, kể cả khi grant cũ chỉ có `openid`) | không có (app tự giữ cookie; access token opaque chỉ dùng cho userinfo) | không |
| `account-ios` | public, native (`none`) | Code + PKCE qua `ASWebAuthenticationSession`, refresh (theo thiết bị, giữ trần 90 ngày), `require_auth_time` | `openid profile email account` | không có: token opaque cho `/api/account` (mục 13) | không |
| client MCP (DCR) | public hoặc confidential | Code + PKCE, refresh (gắn phiên IdP) | mặc định `mock:read mock:write client:read client:write client:send chat:read chat:write bots:read bots:write scribe:read`; thêm `credentials:write`, `bots:admin` chỉ khi khai rõ lúc đăng ký; `offline_access` bị bỏ qua (mục 9) | luôn cả ba: `https://localman.hoandat.com/mcp`, `https://chat.hoandat.com/mcp` và `https://scribe.hoandat.com/mcp` | không được khai |
| `hoandat-account` | nội bộ IdP | không dùng ngoài IdP | | | |

Redirect URI: `${LOCALMAN_WEB_URL}/auth/callback`, `${TUNELO_WEB_URL}/auth/callback`, `${CHAT_WEB_URL}/auth/callback`; post-logout về `/` của app. `chat-mobile` dùng redirect private-use scheme `CHAT_MOBILE_REDIRECT_URI` (mặc định `com.hoandat.chat:/auth/callback`, RFC 8252 §7.1, phải trùng `urlScheme` trong `brand.config.json` của app chat). Không có client desktop: trên máy tính, Chat chạy bản web (`chat-web`) cài dạng PWA; client `chat-desktop` đã gỡ ngày 20/10/2026 và IdP trả lỗi cho mọi request mang id đó. Phần riêng của app chat: `chat-next/docs/integrations/hoandat-auth.md`. Scribe: `${SCRIBE_WEB_URL}/api/auth/callback`, `scribe-mobile` dùng `SCRIBE_MOBILE_REDIRECT_URI` (mặc định `com.hoandat.scribe:/auth/callback`), `scribe-web-dev` dùng `${SCRIBE_WEB_DEV_URL}/api/auth/callback` (loopback; client web không được nới cổng như client native). Miu World: `${MIU_WEB_URL}/api/auth/callback`, `miu-mobile` dùng `MIU_MOBILE_REDIRECT_URI` (mặc định `com.hoandat.miu:/auth/callback`, trùng `urlScheme` của `miu-world-next/brand.config.json`), `miu-web-dev` dùng `${MIU_WEB_DEV_URL}/api/auth/callback`. Miu tự giữ phiên (cookie web, token opaque trong Keychain/Keystore cho app) nên không nhận refresh token; email đã xác minh lấy từ `userinfo` (mục 4), xác thực lại cho thao tác nhạy cảm bằng `prompt=login&max_age=0` rồi kiểm `auth_time`. Như mọi client native, `miu-mobile` luôn qua trang duyệt của IdP (một lần chạm "Cho phép"). PKCE (`S256`) bắt buộc với **mọi** client, kể cả confidential.

**`aud` chính xác** (so khớp nguyên chuỗi, không `/` cuối):

| Resource server | `aud` | Scope |
|---|---|---|
| API Localman | `https://localman.hoandat.com` | `mock:*`, `client:*` |
| MCP của Localman | `https://localman.hoandat.com/mcp` | `mock:*`, `client:*`, `credentials:write` |
| API Tunelo | `https://tunnel.hoandat.com` | `tunnels:open`, `tunnels:read` |
| MCP của Chat | `https://chat.hoandat.com/mcp` | `chat:read`, `chat:write`, `bots:read`, `bots:write`, `bots:admin` |
| MCP của Scribe | `https://scribe.hoandat.com/mcp` | `scribe:read` (chỉ đọc) |

**Scope API và câu hiện trên trang consent** (nguồn: `SCOPE_TEXT` trong `src/interactions/consent-page.ts`; danh sách "Ứng dụng đã cấp quyền" ở `/account` dùng cùng câu):

| Scope | Resource | Mặc định cho client MCP | Câu trên consent |
|---|---|---|---|
| `mock:read` | Localman, MCP | có | Xem project mock trên Localman mà bạn có quyền truy cập, gồm resource, schema và dữ liệu |
| `mock:write` | Localman, MCP | có | Tạo, sửa, xoá project và resource mock trên Localman, sinh hoặc reset dữ liệu |
| `client:read` | Localman, MCP | có | Xem workspace và thành viên, collection, request và environment trong API client của Localman mà bạn có quyền truy cập, cùng cách chúng được chia sẻ (biến secret luôn bị che) |
| `client:write` | Localman, MCP | có | Tạo, sửa, xoá, import collection và request, đặt biến environment và quản lý workspace trong API client của Localman |
| `client:send` | Localman, MCP | có | Gửi request thay bạn qua proxy của Localman, kể cả tới localhost qua Tunelo (tính vào hạn mức proxy) |
| `credentials:write` | chỉ MCP | **không** | Tạo token truy cập cá nhân, secret của service account và access key trên Localman; kèm cảnh báo đỏ "Cho phép tạo khoá truy cập và secret mới thay bạn. Chỉ cấp cho ứng dụng bạn tin tưởng." |
| `tunnels:open` | Tunelo | | Mở tunnel mới bằng tài khoản của bạn |
| `tunnels:read` | Tunelo | | Xem danh sách tunnel của bạn |
| `chat:read` | MCP của Chat | có | Xem danh sách cuộc trò chuyện, đọc và tìm tin nhắn trong các cuộc trò chuyện của bạn trên Chat, cùng thông tin người dùng và thành viên |
| `chat:write` | MCP của Chat | có | Thao tác trên Chat với tư cách của bạn: gửi, sửa, xoá tin nhắn, thả cảm xúc và đánh dấu đã đọc; tạo nhóm, kênh và quản lý thành viên, link mời, chủ đề, quyền quản trị; tắt thông báo và ghim cuộc trò chuyện; quản lý danh bạ, người bị chặn và webhook đến |
| `bots:read` | MCP của Chat | có | Xem bot của bạn trên Chat, cấu hình webhook và tình trạng giao tin (kể cả tin giao lỗi) |
| `bots:write` | MCP của Chat | có | Tạo bot, sửa thông tin và lệnh của bot, gửi lại hoặc bỏ các tin giao lỗi trên Chat |
| `bots:admin` | MCP của Chat | **không** | Đặt hoặc gỡ webhook, cấp lại token và xoá bot của bạn trên Chat; kèm cảnh báo đỏ "Cho phép chuyển mọi tin gửi tới bot sang địa chỉ khác (webhook), cấp lại token và xoá bot. Chỉ cấp cho ứng dụng bạn tin tưởng." |
| `scribe:read` | MCP của Scribe | có | Đọc bản ghi và tệp của bạn trên Scribe: bản chép lời, biên bản, bản dịch, người nói và dấu mốc, tìm kiếm và đặt câu hỏi trên chúng (chỉ đọc) |

`credentials:write` (tool MCP tạo PAT, tạo/xoay secret service account, tạo access key) không bao giờ được cấp ngầm: client MCP phải khai nó trong `scope` lúc đăng ký (client đăng ký không khai `scope` chỉ nhận các scope mặc định, xin thêm thì bị `invalid_scope`), rồi xin nó trong authorization request; user thấy cảnh báo đỏ trên trang consent. `localman-web` không có scope này. Endpoint MCP phải kiểm `credentials:write` trong `scope` của access token trước khi chạy các tool đó. `bots:admin` (đặt/gỡ webhook, cấp lại token, xoá bot) theo đúng quy tắc đó, với cảnh báo đỏ riêng; endpoint MCP của Chat phải kiểm nó.

Request không có `resource` chỉ được gắn audience khi đúng **một** resource client được phép có scope nằm trong scope xin: client MCP được phép cả ba resource MCP nên xin chỉ scope Chat thì gắn `https://chat.hoandat.com/mcp`, chỉ scope Localman thì gắn `https://localman.hoandat.com/mcp`, chỉ `scribe:read` thì gắn `https://scribe.hoandat.com/mcp`; xin lẫn scope của nhiều resource thì không gắn resource nào (gửi `resource` rõ ràng). Đăng nhập chỉ với `openid profile email` nhận **access token opaque không có `aud` API**: chỉ dùng cho `userinfo` (và làm subject của token exchange), không bao giờ là token gọi API.

## 3. Xác minh access token (resource server)

Access token API là JWT ES256, header `typ: at+jwt`, sống 15 phút. Xác minh offline bằng `jose` với JWKS cache (`createRemoteJWKSet` tự cache và tự tải lại khi gặp `kid` lạ). Bắt buộc kiểm `iss`, `aud` của chính mình, `exp` (jose tự kiểm), `alg`, `typ` và scope:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const ISSUER = "https://auth.hoandat.com";
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/jwks`)); // dùng jwks_uri từ discovery

export async function verifyAccessToken(token: string, requiredScope: string) {
	const { payload } = await jwtVerify(token, jwks, {
		issuer: ISSUER,
		audience: "https://tunnel.hoandat.com", // aud của CHÍNH app này
		algorithms: ["ES256"],
		typ: "at+jwt", // chặn ID token và logout token
	});
	const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
	if (!scopes.includes(requiredScope)) throw new Error("insufficient_scope");
	return { sub: String(payload.sub), clientId: String(payload.client_id), scopes };
}
```

- `sub` là id tài khoản ổn định (`acc_…`), không đổi khi user đổi email hay username.
- Token đã ký không thu hồi được: thu hồi grant làm refresh token chết ngay, nhưng JWT còn hiệu lực tới `exp` (tối đa 15 phút).
- Thời gian cache JWKS phía app là một phần thời gian xoay khoá (ADR 0001 mục 4); giữ mặc định của `jose`, đừng cache lâu hơn vài giờ.
- Mẫu tham chiếu trong repo: `src/__tests__/helpers/verify-access-token.ts`.

## 4. Localman web

1. `/auth/login`: tạo `state`, `nonce`, `code_verifier` (lưu tạm phía server), chuyển tới `buildAuthorizationUrl(config, { redirect_uri, scope: "openid profile email", code_challenge, code_challenge_method: "S256", state, nonce })`. **Không** xin `offline_access` (client không có scope này, IdP trả `invalid_scope`), **không** gửi `resource` và không xin scope API Localman, để access token là opaque (cần cho token exchange, mục 6).
2. `/auth/callback`: `authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce })`; lấy `sub` và `sid` từ ID token (`tokens.claims()`), tạo phiên `__Host-lm_session` gắn `sub` và `sid`, lưu refresh token đã mã hoá. IdP vẫn cấp refresh token, nhưng nó **gắn với phiên IdP** (Jev 0.94): đăng xuất ở IdP, phiên IdP hết hạn hay bị thu hồi thì grant, refresh token và token exchange của Localman chết theo.
3. Access token hết hạn thì refresh (mục 8). Refresh nhận `invalid_grant` nghĩa là phiên IdP đã kết thúc: xoá phiên Localman và đăng nhập lại. `/auth/logout`: xoá phiên của app rồi chuyển tới `end_session_endpoint` với `id_token_hint` và `post_logout_redirect_uri`.
4. Back-channel logout (mục 5) vẫn bắt buộc: refresh token chết ở IdP không xoá được cookie `__Host-lm_session` đang mở trong trình duyệt; chỉ logout token cho Localman biết để huỷ phiên ngay.

### Ngôn ngữ trang IdP: `ui_locales`

Trang IdP có English (mặc định), `zh-CN` và `vi`; discovery quảng bá `ui_locales_supported: ["en", "zh-CN", "vi"]`. Client nên gửi `ui_locales=<ngôn ngữ đang hiển thị>` trong authorization request để người dùng thấy cùng ngôn ngữ với app. Localman web làm vậy: web gọi `/auth/login?locale=<en|zh-CN|vi>`, API kiểm bằng `isLocale` rồi chuyển thành `ui_locales`.

- IdP đọc `ui_locales` theo thứ tự ưu tiên, lấy tag đầu tiên khớp theo ngôn ngữ chính (`vi-VN` là `vi`, mọi `zh*` là `zh-CN`); tag lạ bị bỏ qua, không lỗi.
- Thứ tự chọn ngôn ngữ của trang: lựa chọn người dùng vừa bấm trên chính lần đăng nhập đó, rồi `ui_locales`, rồi cookie chung `hd_lang` (nút chuyển ngôn ngữ ở đây hoặc ở app khác), rồi `Accept-Language`, rồi English.
- Nút chuyển ngôn ngữ ở chân mọi trang là link `GET /lang?set=<locale>&return=<path>` (không JavaScript): đặt cookie `hd_lang` rồi `303` về `return`. `hd_lang` là cookie ngôn ngữ dùng chung của mọi app (`@achoo254/app-shell`): `Domain=<TENANT_DOMAIN>` khi issuer nằm dưới tên miền đó (`auth.hoandat.com` → `Domain=hoandat.com`, host khác như localhost thì cookie chỉ thuộc host), `Path=/`, 1 năm, `SameSite=Lax`, `Secure` khi issuer là https, **không** `HttpOnly` để script của các app đọc được; bản `HttpOnly` chỉ thuộc host của các bản trước bị xoá cùng lúc, và khi trình duyệt còn gửi cả hai thì IdP lấy giá trị sau cùng (cookie mới hơn). Đổi ngôn ngữ ở app khác cũng đổi trang IdP. `return` chỉ nhận path cùng origin bắt đầu bằng `/`; `//`, `/\`, scheme, ký tự điều khiển, dấu `\` ở bất kỳ đâu hay chính `/lang` đều bị đưa về `/account`. Khi `return` là trang của một interaction, endpoint đặt thêm cookie `hd_lang_interaction` với `Path=/interaction/<uid>`, nên lựa chọn đó thắng `ui_locales` cho đến hết lần đăng nhập ấy mà không ảnh hưởng lần đăng nhập sau.
- Bot Telegram của IdP nói ngôn ngữ của trang `/account` mà người dùng tạo link liên kết (lưu cùng tài khoản, đổi theo lần mở `/account` gần nhất khi đang liên kết); chi tiết ở README, mục Telegram. Nội dung sự kiện audit giữ nguyên tiếng Việt.

### Nút "Bắt đầu miễn phí": `prompt=create`

IdP hỗ trợ [OpenID Connect Prompt Create 1.0](https://openid.net/specs/openid-connect-prompt-create-1_0.html); discovery quảng bá `prompt_values_supported: ["none", "create", "login", "consent"]` (kiểm giá trị này trước khi hiện nút). Mọi client (tĩnh hoặc DCR) đều dùng được.

- Gửi authorization request như bước 1 ở trên, thêm `prompt: "create"`. IdP mở thẳng trang **đăng ký** thay vì trang đăng nhập, kể cả khi user đã có phiên IdP (theo spec). Trang đăng ký chỉ có nút "Đăng ký với <provider>" của Google, GitHub và Apple khi bật (IdP không có mật khẩu, ADR 0004, 0008): danh tính chưa có tài khoản thì chọn username rồi tạo tài khoản mới; danh tính đã liên kết thì đăng nhập vào tài khoản đó. Xong thì IdP quay về `redirect_uri` với `code` như một lần đăng nhập bình thường; callback xử lý y hệt.
- Trên trang đăng ký có "Đã có tài khoản? Đăng nhập" (giữ nguyên request, không quay về app); nút Google/GitHub/Apple dùng đúng luồng liên kết/tạo tài khoản của trang đăng nhập. Mọi luật cũ vẫn áp dụng: giới hạn tần suất, CSRF.
- `prompt=create none` (hay `none` đi cùng bất kỳ giá trị nào) bị trả về `redirect_uri` với `error=invalid_request`. Không gửi `prompt` thì luồng không đổi (trang đăng nhập với nút Google/GitHub/Apple; lần đầu đăng nhập bằng một danh tính mới cũng tạo tài khoản).

```ts
const url = oidc.buildAuthorizationUrl(config, {
	redirect_uri: "https://localman.hoandat.com/auth/callback",
	scope: "openid profile email telegram",
	prompt: "create",
	code_challenge,
	code_challenge_method: "S256",
	state,
	nonce,
});
```

### Claim hồ sơ

| Scope | Claim | Ở đâu |
|---|---|---|
| `openid` | `sub` | ID token, userinfo |
| `profile` | `preferred_username`, `name`, `picture`, `telegram_linked` | userinfo |
| `email` | `email`, `email_verified` (`true` chỉ khi Google/GitHub/Apple xác minh). Người đăng nhập bằng Apple có thể có email chuyển tiếp `…@privaterelay.appleid.com` (đã xác minh, chuyển tới hộp thư thật; app muốn gửi mail tới đó phải đăng ký domain gửi ở Apple) | userinfo |
| `telegram` (chỉ `localman-web`) | `telegram_chat_id` (chuỗi), `telegram_username` (không có `@`, có thể thiếu) | **chỉ userinfo**, và chỉ khi đã liên kết |

**Xác thực lại ở provider (chỉ client của Miu World).** Khi `miu-web`, `miu-mobile` hay `miu-web-dev` đòi đăng nhập mới (`prompt=login`, `max_age=0`, hoặc phiên IdP cũ hơn `max_age`; `freshLoginRequired`, `src/interactions/upstream-start.ts`), IdP chỉ cho chọn provider chứng minh được lần xác thực mới: Google được gọi với `prompt=login&max_age=0` và `claims={"id_token":{"auth_time":{"essential":true}}}` (Google chỉ gửi `auth_time` khi được hỏi như vậy), Apple không có tham số; GitHub không ép nhập lại được nên không hiện và `/interaction/<uid>/upstream/github` trả 404. Chỉ khi ID token của provider có `auth_time` trong 2 phút, ID token của IdP mới có `amr` `"reauth"` (`["fed", "<provider>", "reauth"]`); thiếu hay cũ thì vẫn đăng nhập nhưng không có `reauth` (đóng an toàn: Miu không mở PIN và báo liên hệ hỗ trợ). Client khác (cổng `/account` với `prompt=login` của nó, Chat với `max_age=600`, Scribe, Localman) giữ đăng nhập thường: Google `select_account`, GitHub vẫn có, không kiểm `auth_time` của provider. `amr` là của phiên IdP, nên client phải kiểm cùng `auth_time` của ID token IdP (Miu: trong 5 phút).

**Kiểm sau deploy (người sở hữu):** Google có thể không trả `auth_time` dù được hỏi (tài liệu Google gắn nó với tham số `claims` và cài đặt session age). Sau deploy làm một lần mở PIN bị khóa thật ở Miu bằng Google: phải về Miu với PIN mở; nếu Miu báo "chưa xác nhận lại được" thì Google không gửi `auth_time` (PIN vẫn khóa, an toàn), cần xem lại cài đặt OAuth client của Google hoặc dùng Apple.

**`google_sub` (chỉ Miu World).** Userinfo của `miu-web`, `miu-mobile`, `miu-web-dev` (scope `email`) có thêm `google_sub`: `sub` của tài khoản Google đã liên kết với tài khoản IdP, để Miu đối chiếu với phụ huynh của cách đăng nhập Google trực tiếp cũ trước khi liên kết. Không bao giờ có trong ID token, không client nào khác nhận (`GOOGLE_SUB_CLIENTS`, `src/oidc/claims.ts`).

Với code flow, ID token chỉ có `sub` (kèm `sid`, `auth_time`); claim của `profile` và `email` **không** nằm trong ID token (oidc-provider giữ `conformIdTokenClaims` mặc định). Client lấy hồ sơ bằng `userinfo_endpoint` với access token vừa nhận và kiểm `sub` của userinfo khớp ID token (Scribe từng đọc `email` trong ID token và từ chối mọi lần đăng nhập, 16/10/2026).

### Chat Telegram cho thông báo của Localman

- Localman xin thêm scope `telegram` khi đăng nhập (`scope: "openid profile email telegram"`). Là client first-party nên IdP **không hiện trang consent** cho scope này (như mọi scope khác của `localman-web`); trang `/account` của IdP cho user thấy và gỡ liên kết Telegram bất cứ lúc nào. Client khác (`tunelo-*`, `hoandat-account`, client MCP) xin `telegram` thì nhận `invalid_scope`.
- Gọi `userinfo_endpoint` bằng access token opaque của phiên: có `telegram_chat_id` thì gửi thông báo tới chat đó bằng bot riêng của Localman; không có (chưa liên kết hoặc đã gỡ) thì hiện nút "Liên kết Telegram" dẫn tới `${issuer}/account`. Claim không bao giờ nằm trong ID token hay access token JWT, nên đừng tìm nó ở `tokens.claims()`.
- Bot của Localman chỉ nhắn được cho user đã từng bấm Start với **chính bot đó** (Telegram trả 403 "bot can't initiate conversation" nếu chưa). `telegram_chat_id` là chat riêng giữa user và bot của IdP, có cùng giá trị với id người dùng Telegram, nên dùng được cho bot Localman sau khi user mở `t.me/<bot Localman>` và bấm Start; gặp 403 thì nhắc user làm việc đó.
- Chat có thể đổi (liên kết lại chat khác) hoặc bị gỡ. Localman phải đọc lại `userinfo` (a) mỗi lần đăng nhập, (b) mỗi lần refresh access token, và (c) khi nhận sự kiện audit `method.linked` hoặc `method.unlinked` với `method: "telegram"` (mục 10) của user đó; khi đó xoá chat cũ đã lưu. Không gửi gì tới chat cũ sau khi `userinfo` không còn trả nó.

## 5. Back-channel logout (Localman web, Tunelo web, Chat web)

Khi user đăng xuất ở IdP hoặc phiên IdP bị thu hồi (ở `/account`), IdP `POST` form `logout_token=<JWT>` tới URI back-channel của client. App phải:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

export async function handleLogoutToken(logoutToken: string): Promise<void> {
	const { payload } = await jwtVerify(logoutToken, jwks, {
		issuer: ISSUER,
		audience: "localman-web", // client_id của app
		algorithms: ["ES256"],
		typ: "logout+jwt",
		maxTokenAge: "2 minutes",
	});
	const events = payload.events as Record<string, unknown> | undefined;
	if (!events || !(BACKCHANNEL_EVENT in events) || "nonce" in payload) {
		throw new Error("not a logout token");
	}
	if (await seenJti(String(payload.jti))) return; // chống phát lại
	if (typeof payload.sid === "string") await destroySessionsBySid(payload.sid);
	else await destroySessionsBySub(String(payload.sub));
}
```

- Trả `200` (hoặc `204`) khi xử lý xong, `400` khi token sai. Không cần cookie hay CSRF: route này do IdP gọi server-to-server.
- Hai client đều bật `backchannel_logout_session_required`, nên token luôn có `sid`; huỷ đúng các phiên app gắn `sid` đó.

## 6. Token exchange: Localman gọi API Tunelo thay user

Chỉ `localman-web` được dùng (RFC 8693). Subject token là **access token opaque** của phiên Localman (mục 4); access token JWT bị từ chối vì IdP không kiểm được nó còn sống hay không.

```ts
import * as oidc from "openid-client";

const tunelo = await oidc.genericGrantRequest(
	config, // discovery của localman-web với ClientSecretBasic
	"urn:ietf:params:oauth:grant-type:token-exchange",
	{
		subject_token: session.accessToken,
		subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
		resource: "https://tunnel.hoandat.com", // hoặc audience=
		scope: "tunnels:read", // có thể bỏ; mặc định tunnels:read
	},
);
// tunelo.access_token: JWT aud=https://tunnel.hoandat.com, scope=tunnels:read
// tunelo.issued_token_type = urn:ietf:params:oauth:token-type:access_token
```

- Token cấp ra: `sub` của user, `client_id` và `azp` là `localman-web`, `act: {"sub": "localman-web"}`, `exp` sau 15 phút, **không có refresh token**. Cache theo user tới gần `exp` rồi đổi lại; nếu access token của phiên đã hết hạn thì refresh phiên trước. Token endpoint giới hạn 60 request mỗi phút cho mỗi IP, và mọi lần đổi code, refresh, token exchange của Localman đều đi từ IP của server Localman, nên không đổi token ở mỗi request.
- Phiên Localman sống theo phiên IdP: sau khi user đăng xuất ở IdP, token exchange với access token cũ trả `invalid_request`.
- Lỗi: client khác hoặc client không được phép thì `unauthorized_client`; sai secret thì `invalid_client` (401); `resource`/`audience` khác Tunelo thì `invalid_target` (thiếu cả hai thì `invalid_request`); scope khác `tunnels:read` thì `invalid_scope`; subject token sai loại, hết hạn, đã thu hồi, grant đã bị thu hồi (đăng xuất, thu hồi ở `/account`), tài khoản bị khoá thì `invalid_request` (RFC 8693 §2.2.2). Gặp `invalid_request` vì subject token thì coi như phiên đã chết: đăng nhập lại.
- Phía Tunelo, `GET /api/tunnels` xác minh như mục 3 với `aud=https://tunnel.hoandat.com` và scope `tunnels:read`, rồi liệt kê theo `sub`. `client_id` cho biết token đến từ Localman.

## 7. Tunelo CLI (device flow)

```ts
const cli = await oidc.discovery(new URL(ISSUER), "tunelo-cli", {}, oidc.None());
const device = await oidc.initiateDeviceAuthorization(cli, {
	scope: "openid offline_access tunnels:open tunnels:read",
	resource: "https://tunnel.hoandat.com",
	device_name: os.hostname().slice(0, 64), // chữ, số, khoảng trắng, ._'()-
});
console.log(`Mở ${device.verification_uri_complete} và xác nhận mã ${device.user_code}`);
const tokens = await oidc.pollDeviceAuthorizationGrant(cli, device);
```

- Trang duyệt luôn hỏi "Cho phép `tunelo` trên máy <device_name>?"; đã đăng nhập IdP thì không phải đăng nhập lại. Mỗi máy một grant, thu hồi từng máy ở `/account`.
- Lưu refresh token với quyền file `0600`. `tunelo logout`: gọi `revocation_endpoint` với refresh token rồi xoá file.

## 8. Refresh token và phiên trượt

- Refresh token **dùng một lần, xoay vòng**: mỗi lần refresh nhận token mới; đưa lại token cũ làm IdP thu hồi cả grant. Hai refresh song song cùng một token thì một cái nhận `invalid_grant`. Vì vậy **phải khoá khi refresh** (Tunelo CLI: file lock vì nhiều tiến trình; app web: mutex theo phiên) và ghi token mới trước khi nhả khoá.
- **Phiên trượt 30/90 ngày**: mỗi lần refresh thành công, grant được gia hạn tới 30 ngày sau lần đó, nhưng không quá 90 ngày kể từ lúc đăng nhập. Không refresh quá 30 ngày thì phải đăng nhập lại; tới ngày 90 thì luôn phải đăng nhập lại ở app web. Riêng thiết bị Tunelo CLI (`tunelo-cli`), app chat native (`chat-mobile`) và app Scribe (`scribe-mobile`) không có trần 90 ngày: còn refresh trong 30 ngày là phiên còn mãi (thu hồi từng máy ở `/account`).
- `chat-mobile` nhận refresh token không cần `offline_access`, và refresh token của nó không chết khi người dùng đăng xuất trên trình duyệt: mỗi máy là một grant riêng.
- Mỗi lần duyệt đăng nhập của `chat-mobile` (và `scribe-mobile`) tạo một grant mới cho máy đó; `/account` liệt kê từng máy dưới mục "Thiết bị" (`<tên app> · <tên máy>`) và đăng xuất riêng từng máy (refresh của máy đó nhận `invalid_grant`, máy khác không ảnh hưởng). App nên gửi `device_name=<tên máy>` trong authorization request (tối đa 64 ký tự chữ, số, khoảng trắng, `._'()-`; sai định dạng thì IdP trả `invalid_request`); thiếu thì IdP ghi User-Agent của trình duyệt đã duyệt.
- `localman-web`, `tunelo-web`, `chat-web` và client MCP không có `offline_access` (client MCP xin thì bị bỏ qua, mục 9): refresh token của chúng gắn với phiên trình duyệt ở IdP (đăng xuất ở IdP là hết), vẫn theo trần 30/90 ngày.
- `revocation_endpoint`: client chỉ thu hồi được token của chính nó. Thu hồi refresh token thu hồi cả grant (`tunelo logout`); thu hồi access token làm mọi token của grant mất hiệu lực nhưng giữ grant.

## 9. Client MCP (Localman MCP, Chat MCP, Scribe MCP)

- Localman công bố Protected Resource Metadata với `authorization_servers: ["https://auth.hoandat.com"]` và `resource: "https://localman.hoandat.com/mcp"`; Chat cũng vậy với `resource: "https://chat.hoandat.com/mcp"`, Scribe với `resource: "https://scribe.hoandat.com/mcp"`.
- Client đăng ký qua `registration_endpoint`: redirect chỉ `https://…` hoặc `http://localhost`/`http://127.0.0.1`; scope chỉ trong `mock:*`, `client:*`, `credentials:write`, `chat:*`, `bots:*`, `scribe:read` (bỏ trống `scope` thì nhận `mock:*`, `client:*`, `chat:read chat:write bots:read bots:write scribe:read`, không có `credentials:write` và `bots:admin`; scope khác bị `invalid_client_metadata`); `allowed_resources` do IdP gán, luôn là cả ba resource MCP (client gửi kèm thì chỉ được là tập con khác rỗng của chúng, nếu không bị `invalid_client_metadata`; client đăng ký trước khi có Chat MCP hay Scribe MCP lưu ít resource hơn, được mở rộng thành cả ba khi nạp lại). Client đăng ký trước khi có Scribe MCP với `scope` mặc định không có `scribe:read`: muốn dùng Scribe thì đăng ký lại (Claude Code: xoá rồi thêm lại server); `client_name` (nếu có) dài 1–100 ký tự, không chứa ký tự điều khiển, xuống dòng hay ký tự định hướng bidi (vi phạm thì `invalid_client_metadata`); không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP tối đa 20 đăng ký mỗi giờ.
- `client_name` là tên tự khai và **không bị từ chối vì nội dung**: client MCP thường ghép tên server người dùng đặt vào tên mình (Claude Code đăng ký `"Claude Code (localman)"`), nên tên chứa `localman`, `tunelo`, `hoandat` hay bản nhái (chữ Cyrillic/Greek, `LocaIman`, `L o c a l m a n`…) vẫn đăng ký được. Chống mạo danh nằm ở các trang IdP thay vì lúc đăng ký:
  - Trang consent (luôn hiện với client DCR) đặt tên trong ngoặc kép như dữ liệu người dùng nhập, gắn nhãn "Ứng dụng bên ngoài" và khối cảnh báo "Ứng dụng bên ngoài, không do hoandat.com phát hành"; tên trông giống sản phẩm first-party có thêm cảnh báo đỏ "Tên ứng dụng giống sản phẩm của hoandat.com nhưng không phải".
  - Consent hiện host của `redirect_uri` trong chính request này (vd. `localhost:53682` với Claude Code), để người dùng biết mã cấp quyền được gửi về đâu.
  - Trang đăng nhập, xác nhận đăng xuất và danh sách "Ứng dụng đã cấp quyền" ở `/account` cũng ghi tên client DCR trong ngoặc kép kèm nhãn ứng dụng bên ngoài. Client tĩnh (`localman-web`, `tunelo-*`, `hoandat-account`) hiển thị như cũ.
- Authorization request phải có `resource` khớp server MCP đang kết nối: `https://localman.hoandat.com/mcp`, `https://chat.hoandat.com/mcp` hoặc `https://scribe.hoandat.com/mcp` (resource khác bị `invalid_target`); mỗi access token chỉ mang một `aud`, nên một client dùng nhiều server lấy token riêng cho từng cái; user luôn thấy trang consent nói trên, kể cả khi đã cấp quyền trước đó.
- `offline_access`: SDK MCP (vd. TypeScript SDK 2.x) tự thêm scope này vào đăng ký và authorization request (kèm `prompt=consent`) khi discovery quảng bá nó. IdP **lặng lẽ bỏ** `offline_access` của client DCR thay vì báo lỗi: lúc đăng ký nó không vào `scope` lưu của client (response đăng ký trả `scope` đã bỏ nó), lúc authorize (`GET /auth`) nó bị gỡ khỏi `scope` trước khi kiểm. Chỉ `offline_access` được bỏ qua: scope ngoài danh sách trên vẫn bị `invalid_client_metadata` lúc đăng ký, scope client chưa đăng ký (vd. `credentials:write` khi chưa khai) vẫn bị `invalid_scope` lúc authorize. Client MCP vẫn nhận refresh token như cũ, gắn phiên IdP (mục 8). Authorization request gửi bằng `POST /auth` hoặc PAR không được gỡ: client DCR dùng hai cách đó thì đừng xin `offline_access`. Client tĩnh không có scope này (`localman-web`) vẫn nhận `invalid_scope`.
- Endpoint MCP xác minh như mục 3 với `aud` của chính nó (`https://localman.hoandat.com/mcp`, `https://chat.hoandat.com/mcp` hoặc `https://scribe.hoandat.com/mcp`), rồi kiểm scope của từng tool (`credentials:write` ở Localman, `bots:admin` ở Chat, `scribe:read` ở mọi tool của Scribe).
- Link từ app sang trang tài khoản dùng neo cố định: `${issuer}/account#account-email`, `#account-sign-in` (cách đăng nhập: liên kết/huỷ Apple, Google, GitHub), `#account-apps` (danh sách ứng dụng đã cấp quyền, nơi user thu hồi client MCP). `#account-password` và `#account-recovery` đã bỏ cùng mật khẩu và mã khôi phục (ADR 0004); link cũ chỉ mở đầu trang.

## 10. Sự kiện audit gửi sang Localman

IdP ghi mọi sự kiện credential vào outbox MongoDB và đẩy sang `POST {LOCALMAN}/internal/audit-events` (cấu hình `AUDIT_EVENTS_URL`, `AUDIT_CLIENT_ID`, `AUDIT_CLIENT_SECRET`; chưa cấu hình thì sự kiện nằm chờ).

**Request**

```http
POST /internal/audit-events HTTP/1.1
Content-Type: application/secevent+jwt
Accept: application/json
Authorization: Basic base64("AUDIT_CLIENT_ID:AUDIT_CLIENT_SECRET")
Idempotency-Key: 6b943519-8c56-4f6e-8138-18a3e4ab9b9b

eyJhbGciOiJFUzI1NiIsImtpZCI6Ii4uLiIsInR5cCI6InNlY2V2ZW50K2p3dCJ9...
```

Body là Security Event Token (RFC 8417), header `{alg: "ES256", kid, typ: "secevent+jwt"}`, payload:

```json
{
  "iss": "https://auth.hoandat.com",
  "aud": "https://localman.hoandat.com/internal/audit-events",
  "iat": 1791455925,
  "exp": 1791456525,
  "jti": "6b943519-8c56-4f6e-8138-18a3e4ab9b9b",
  "sub": "acc_kkdcgzA1UBePGbn9aE5uTA",
  "toe": 1791455925,
  "events": {
    "urn:hoandat:auth:event:login.succeeded": {
      "methods": ["fed"],
      "ip": "203.0.113.7",
      "user_agent": "Mozilla/5.0 ..."
    }
  }
}
```

| Loại (`urn:hoandat:auth:event:` + …) | Dữ liệu |
|---|---|
| `login.succeeded` | `methods` (amr: `fed`, đăng nhập qua Google/GitHub/Apple; `pwd` + `review`: đăng nhập cho người duyệt ứng dụng, ADR 0010) |
| `login.failed` | `method` (`review`), `reason` (`unknown-email`, `wrong-password`). Chỉ từ đăng nhập cho người duyệt ứng dụng (ADR 0010); `sub` là tài khoản duyệt hoặc `review-login` |
| `method.linked`, `method.unlinked` | `method` (`apple`, `google`, `github`, `telegram`). Liên kết lại sang chat Telegram khác cũng sinh `method.linked`; Localman đọc lại `userinfo` khi nhận sự kiện có `method: "telegram"` |
| `email.reclaimed` | (tài khoản `sub` mất email chưa xác minh cho chủ đã xác minh) |
| `account.deleted` | `source` (`web`, `app`). Tài khoản `sub` đã bị xoá vĩnh viễn (ADR 0009): `sub` không bao giờ quay lại; đăng nhập lại cùng Google/GitHub/Apple tạo `sub` mới. App nhận sự kiện nên xoá hoặc ẩn dữ liệu của `sub` theo chính sách của mình |
| `grant.created` | `clientId`, `kind` (`device`: duyệt máy Tunelo, có `deviceName`; `third-party-app`: consent client MCP). App first-party đăng nhập không sinh sự kiện này |
| `session.revoked`, `grant.revoked` | `count`, `cause` (`account-page`, `token-revocation`: client thu hồi refresh token ở `revocation_endpoint`), có thể có `clientId` |
| `session.logout` | `scope` (`all`: đăng xuất khỏi IdP; `client`: chỉ khỏi một app), có thể có `clientId` (RP-initiated logout) |

`ip`, `user_agent` có khi sự kiện đến từ một request của user; sự kiện nằm chờ quá 30 ngày (Localman chưa nhận) bị xoá hai trường này trước khi gửi. Sự kiện đã gửi được giữ 30 ngày trong outbox rồi tự xoá. Payload không bao giờ chứa mã, token, link hay secret. Từ khi bỏ mật khẩu (ADR 0004) IdP không còn phát `login.failed` (trừ đăng nhập cho người duyệt, ADR 0010), `login.locked`, `password.changed`, `password.reset`, `recovery_codes.regenerated`, và `cause` không còn `password-change`, `password-reset`, `security-review`; sự kiện cũ loại đó đã nằm trong outbox vẫn được gửi. Thứ tự gửi theo lúc xảy ra (cũ trước), nhưng thử lại có thể làm sự kiện tới không theo thứ tự: sắp theo `toe`.

**Localman phải**

1. Kiểm `Authorization: Basic` bằng cách base64-decode rồi tách ở dấu `:` **đầu tiên** (id không bao giờ chứa `:`; secret có thể chứa `+/=` và gửi nguyên văn, không URL-encode), so sánh constant-time với cặp đã cấu hình.
2. Xác minh JWS bằng JWKS của IdP: `jwtVerify(body, jwks, { issuer, audience: "https://localman.hoandat.com/internal/audit-events", algorithms: ["ES256"], typ: "secevent+jwt" })` (`aud` là URL đầy đủ của endpoint, đúng giá trị `AUDIT_EVENTS_URL` của IdP). Mỗi lần thử lại được ký lại, `exp` là 10 phút sau lúc ký, nên `jose` tự từ chối SET cũ; `toe` là lúc sự kiện xảy ra.
3. Bỏ trùng theo `jti` (bằng `Idempotency-Key`): IdP có thể gửi lại một sự kiện đã nhận nếu phản hồi lần trước bị mất; lần trùng vẫn trả 2xx.
4. Trả `202` (hoặc 2xx bất kỳ) khi đã lưu. Mọi phản hồi khác làm IdP thử lại sau 5 giây, nhân đôi mỗi lần, trần 1 giờ, **không bao giờ bỏ** sự kiện; IdP không đọc body phản hồi.

## 11. Một tenant (ADR 0013)

Từ 24/10/2026 IdP chỉ phục vụ `hoandat.com` (ADR 0013, thay ADR 0006, 0007, 0012): không còn issuer `https://auth.<d>` cho domain khác, không còn API nội bộ trên loopback (`/internal/tenants/*`, cổng `4501`), không còn secret client suy từ khoá gốc hay key AI niêm phong cho Scribe. App giữ cấu hình tĩnh (issuer, audience, client secret từ env) như ở mục 1–10. Mọi token và sự kiện audit vẫn mang tenant `primary` ở phía IdP; app nào lưu `tenantId`/`tenant_id` thì giữ giá trị `primary`, không migrate.

## 12. Chưa làm ở IdP

- **Lookup workspace** (`GET {LOCALMAN}/internal/users/:sub/workspaces`, client credentials, cache 60 giây): IdP chưa có tính năng nào cần nó (trang service account thuộc plan devops phase 01), nên chưa gọi. Khi làm, IdP coi Localman là nguồn duy nhất và không lưu danh sách workspace.
- Service account và grant `client_credentials` (plan devops phase 01): khi có, Tunelo dùng nó để gọi API nội bộ của Localman.

## 13. App iOS "Tài khoản" (`account-ios`) và `/api/account`

App SwiftUI ở `ios/` làm mọi việc của `/account` qua API JSON này; hợp đồng phía app: `ios/contract/README.md` (fixture dùng chung với test Node `src/__tests__/account-api-contract.test.ts`).

**Client.** `account-ios`, public native, PKCE `S256`, scope `openid profile email account`, redirect `${ISSUER}/ios/callback` (đăng nhập) và `${ISSUER}/ios/linked` (kết quả liên kết provider), cả hai là universal link (AASA ở `/.well-known/apple-app-site-association`, có `applinks` cho `/ios/*` và `webcredentials`, chỉ khi có `IOS_APP_ID`). Mỗi lần duyệt là một grant thiết bị mới (trang "Cho phép" của IdP); refresh xoay vòng, gắn thiết bị, trượt 30 ngày, **trần 90 ngày**. ID token luôn có `auth_time` (`require_auth_time`). Mở `/ios/*` bằng trình duyệt thường chỉ thấy trang "Mở app" (`no-store`, `no-referrer`, không đọc query).

**Xác thực.** `Authorization: Bearer <access token opaque của account-ios>`; không cookie, không CSRF. Token phải còn sống, của `account-ios`, có scope `account`, grant còn và cùng client, cùng tài khoản, tài khoản còn hoạt động, đúng tenant (`src/account-api/bearer-auth.ts`, như subject token của mục 6). Không có token: `401` + `WWW-Authenticate: Bearer realm="account"`; JWT, token hết hạn/bị thu hồi, grant đã chết: `401` `invalid_token`; token của client khác hoặc thiếu scope: `403` `insufficient_scope`. Thiết bị bị thu hồi ở web thì lần gọi sau nhận `401` ngay.

**Đăng nhập lại** (thao tác mà web đòi đăng nhập trong 10 phút): body JSON có `id_token` do IdP ký cho `aud=account-ios`, đúng `sub`, `auth_time` ≤ 10 phút, mỗi ID token dùng **một lần** (`src/account-api/recent-auth.ts`). App lấy nó bằng authorize `prompt=login`, chuyển sang token mới rồi thu hồi refresh token cũ để mỗi máy chỉ có một grant. Thiếu, cũ, sai `aud`/`iss`/`sub` hay dùng lại: `403` `reauth_required`. Kiểm tham số rẻ (provider, username) chạy **trước** bước này nên lỗi tham số không làm mất ID token.

| Web (guard) | API | Guard | Trả |
|---|---|---|---|
| `GET /account` | `GET /api/account` | bearer | `200` JSON (dưới) |
| `POST /account/profile` (write) | `PATCH /api/account/profile` `{"name": string\|null}` | bearer | `204`; quá 100 ký tự `400 invalid_name` |
| `POST /account/sessions/:uid/revoke` (write) | `POST /api/account/sessions/:uid/revoke` | bearer | `204`; `404 not_found` |
| `POST /account/devices/:grantId/revoke` (write) | `POST /api/account/devices/:grantId/revoke` | bearer | `204`; `404 not_found` |
| `POST /account/apps/:clientId/revoke` (sensitive) | `POST /api/account/apps/:clientId/revoke` | bearer + đăng nhập lại | `204`; `404 not_found` |
| `POST /account/sessions/revoke-others` (sensitive) | `POST /api/account/sessions/revoke-all` (mọi phiên trình duyệt) | bearer + đăng nhập lại | `204` |
| `POST /account/unlink/:provider` (sensitive) | `POST /api/account/providers/:provider/unlink` | bearer + đăng nhập lại | `204`; cách đăng nhập cuối `409 last_sign_in_method`; chưa liên kết `404` |
| `POST /account/link/:provider` (sensitive) | `POST /api/account/providers/:provider/link` | bearer + đăng nhập lại | `200 {"url"}`; đã liên kết `409 already_linked`; provider không bật `409 provider_unavailable` |
| (callback của web) | `POST /api/account/providers/:provider/link/complete` `{"ref"}` | bearer cùng grant đã bắt đầu | `200 {"result"}`; `404 not_found` |
| `POST /account/delete` (sensitive) | `DELETE /api/account` `{"id_token","username"}` | bearer + đăng nhập lại | `204`; sai username `400 username_mismatch` |
| — | `PUT /api/account/push-device` `{"token","environment","locale"}` | bearer | `204` (APNs tắt: không lưu gì) |
| — | `DELETE /api/account/push-device` | bearer | `204` |

Mỗi thao tác gọi cùng hàm với route web (`src/account-portal/account-actions.ts`, `deleteAccount`) nên ghi cùng sự kiện audit (`session.revoked`, `grant.revoked`, `method.unlinked`, `account.deleted` với `source: "app"`). Lỗi luôn là `{"error","error_description"}`; đường dẫn lạ dưới `/api/account` trả `404 not_found` JSON. Giới hạn tần suất (theo phút): 120 request mỗi IP cho cả prefix, 60 mỗi tài khoản sau khi xác thực, 10 mỗi tài khoản cho thao tác đăng nhập lại và link; quá thì `429 rate_limited` + `Retry-After`. Path có tham số tính chung một ngân sách.

**`GET /api/account`** (`src/account-api/account-api-view.ts`, chép từng trường): `account` (`id`, `username`, `name`, `email`, `emailVerifiedBy`, `picture`, `createdAt`, `reclaimedEmail`), `providers[]` (Apple, Google, GitHub: `enabled`, `linked`, `email`, `login`, `linkedAt`, `canUnlink`), `telegram` (`available`, `linked`, `username`, `name`, `linkedAt`; app chỉ hiển thị), `sessions[]` (`uid`, `loginAt`, `lastSeenAt`, `browser`, `os`, `ip`), `devices[]` (`grantId`, `clientId`, `appName`, `deviceName`, `grantedAt`, `expiresAt`, `current`), `apps[]` (`clientId`, `name`, `firstParty`, `redirectHosts`, `scopes`), `canDelete`. Ngày là ISO 8601, giá trị thiếu là `null`. Không bao giờ có `revocationToken`, `providerDetails` thô, id tài khoản provider, `securityVersion`, `tenantId`, chat id Telegram, User-Agent.

**Liên kết provider từ app** (ADR 0009 §5), hai bước. `POST .../providers/:provider/link` (đã đăng nhập lại) cấp một state upstream một lần, sống 5 phút, gắn tài khoản, `securityVersion` và grant của access token, rồi trả `https://<issuer>/oauth/<provider>/start?state=…`. App mở URL trong `ASWebAuthenticationSession`: `/start` chỉ mở được một lần, đặt cookie state rồi sang provider. Callback **không liên kết** (URL có thể bị chuyển sang trình duyệt người khác): nó giữ câu trả lời của provider trong một token một lần (`ref` 256 bit, 5 phút, gắn tài khoản và grant), không đọc hay tạo phiên IdP, rồi `303` về `${ISSUER}/ios/linked?result=pending&ref=…&provider=<id>` (lỗi ở bước provider: `result=expired|failed|cancelled`, không có `ref`). App xác nhận bằng `POST /api/account/providers/:provider/link/complete` `{"ref"}` với bearer của **chính grant đã bắt đầu**: `200 {"result": "linked"|"owned_by_other"|"already_linked"|"expired"|"failed"}`; `ref` của grant, tài khoản hay provider khác, đã dùng hoặc hết hạn là `404 not_found`. Bước này chạy mọi kiểm của web (provider không thuộc tài khoản khác, chưa liên kết, ghi có điều kiện theo `securityVersion` lúc cấp state).

**Thông báo đẩy** (APNs, chỉ khi có đủ `APNS_*`). Thiết bị đăng ký token gắn với grant của access token; token sống, trượt và chết theo grant (thu hồi ở web, ở `/token/revocation`, refresh token dùng lại, hết hạn, xoá tài khoản). Sự kiện: `new-sign-in` (đăng nhập web mới hoặc grant thiết bị mới), `provider-linked`, `provider-unlinked`, `email-reclaimed`, `access-revoked`. Payload `{"aps":{"alert":{"title","body"},"sound":"default","thread-id":"account-security"},"kind","at"}`, đã dịch theo `locale` của thiết bị, không bao giờ có email, IP, mã, link hay token; tên ứng dụng chỉ là tên client first-party. Máy gây ra sự kiện qua API không nhận thông báo của chính nó.
