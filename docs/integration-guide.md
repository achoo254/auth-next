# Hướng dẫn tích hợp với `auth.hoandat.com`

Tài liệu cho Localman web, Localman MCP, Tunelo CLI, Tunelo web và Localman (nhận audit). Quyết định phía IdP: [ADR 0001](decisions/0001-own-oidc-idp.md), [ADR 0002](decisions/0002-accounts-and-login-pages.md), [ADR 0003](decisions/0003-token-exchange-and-audit-outbox.md), [ADR 0004](decisions/0004-upstream-only-sign-in.md) (chỉ đăng nhập bằng Google/GitHub).

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
| client MCP (DCR) | public hoặc confidential | Code + PKCE, refresh (gắn phiên IdP) | mặc định `mock:read mock:write client:read client:write client:send`; thêm `credentials:write` chỉ khi khai rõ lúc đăng ký; `offline_access` bị bỏ qua (mục 9) | luôn `https://localman.hoandat.com/mcp` | không được khai |
| `hoandat-account` | nội bộ IdP | không dùng ngoài IdP | | | |

Redirect URI: `${LOCALMAN_WEB_URL}/auth/callback`, `${TUNELO_WEB_URL}/auth/callback`; post-logout về `/` của app. PKCE (`S256`) bắt buộc với **mọi** client, kể cả confidential.

**`aud` chính xác** (so khớp nguyên chuỗi, không `/` cuối):

| Resource server | `aud` | Scope |
|---|---|---|
| API Localman | `https://localman.hoandat.com` | `mock:*`, `client:*` |
| MCP của Localman | `https://localman.hoandat.com/mcp` | `mock:*`, `client:*`, `credentials:write` |
| API Tunelo | `https://tunnel.hoandat.com` | `tunnels:open`, `tunnels:read` |

**Scope API và câu hiện trên trang consent** (nguồn: `SCOPE_TEXT` trong `src/interactions/consent-page.ts`; danh sách "Ứng dụng đã cấp quyền" ở `/account` dùng cùng câu):

| Scope | Resource | Mặc định cho client MCP | Câu trên consent |
|---|---|---|---|
| `mock:read` | Localman, MCP | có | Xem project mock trên Localman mà bạn có quyền truy cập, gồm resource, schema và dữ liệu |
| `mock:write` | Localman, MCP | có | Tạo, sửa, xoá project và resource mock trên Localman, sinh hoặc reset dữ liệu |
| `client:read` | Localman, MCP | có | Xem workspace, collection, request và environment trong API client của Localman mà bạn có quyền truy cập (biến secret luôn bị che) |
| `client:write` | Localman, MCP | có | Tạo, sửa, xoá, import collection và request, đặt biến environment trong API client của Localman |
| `client:send` | Localman, MCP | có | Gửi request thay bạn qua proxy của Localman, kể cả tới localhost qua Tunelo (tính vào hạn mức proxy) |
| `credentials:write` | chỉ MCP | **không** | Tạo token truy cập cá nhân, secret của service account và access key trên Localman; kèm cảnh báo đỏ "Cho phép tạo khoá truy cập và secret mới thay bạn. Chỉ cấp cho ứng dụng bạn tin tưởng." |
| `tunnels:open` | Tunelo | | Mở tunnel mới bằng tài khoản của bạn |
| `tunnels:read` | Tunelo | | Xem danh sách tunnel của bạn |

`credentials:write` (tool MCP tạo PAT, tạo/xoay secret service account, tạo access key) không bao giờ được cấp ngầm: client MCP phải khai nó trong `scope` lúc đăng ký (client đăng ký không khai `scope` chỉ nhận năm scope mặc định, xin thêm thì bị `invalid_scope`), rồi xin nó trong authorization request; user thấy cảnh báo đỏ trên trang consent. `localman-web` không có scope này. Endpoint MCP phải kiểm `credentials:write` trong `scope` của access token trước khi chạy các tool đó.

Request không có `resource` chỉ được gắn audience khi scope có ít nhất một scope của resource duy nhất mà client được phép. Đăng nhập chỉ với `openid profile email` nhận **access token opaque không có `aud` API**: chỉ dùng cho `userinfo` (và làm subject của token exchange), không bao giờ là token gọi API.

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
- Thứ tự chọn ngôn ngữ của trang: lựa chọn người dùng vừa bấm trên chính lần đăng nhập đó, rồi `ui_locales`, rồi cookie `hd_lang` của nút chuyển ngôn ngữ, rồi `Accept-Language`, rồi English.
- Nút chuyển ngôn ngữ ở chân mọi trang là link `GET /lang?set=<locale>&return=<path>` (không JavaScript): đặt cookie `hd_lang` (1 năm, `HttpOnly`, `SameSite=Lax`, `Secure` khi issuer là https) rồi `303` về `return`. `return` chỉ nhận path cùng origin bắt đầu bằng `/`; `//`, `/\`, scheme, ký tự điều khiển, dấu `\` ở bất kỳ đâu hay chính `/lang` đều bị đưa về `/account`. Khi `return` là trang của một interaction, endpoint đặt thêm cookie `hd_lang_interaction` với `Path=/interaction/<uid>`, nên lựa chọn đó thắng `ui_locales` cho đến hết lần đăng nhập ấy mà không ảnh hưởng lần đăng nhập sau.
- Bot Telegram của IdP nói ngôn ngữ của trang `/account` mà người dùng tạo link liên kết (lưu cùng tài khoản, đổi theo lần mở `/account` gần nhất khi đang liên kết); chi tiết ở README, mục Telegram. Nội dung sự kiện audit giữ nguyên tiếng Việt.

### Nút "Bắt đầu miễn phí": `prompt=create`

IdP hỗ trợ [OpenID Connect Prompt Create 1.0](https://openid.net/specs/openid-connect-prompt-create-1_0.html); discovery quảng bá `prompt_values_supported: ["none", "create", "login", "consent"]` (kiểm giá trị này trước khi hiện nút). Mọi client (tĩnh hoặc DCR) đều dùng được.

- Gửi authorization request như bước 1 ở trên, thêm `prompt: "create"`. IdP mở thẳng trang **đăng ký** thay vì trang đăng nhập, kể cả khi user đã có phiên IdP (theo spec). Trang đăng ký chỉ có nút "Đăng ký với Google/GitHub" (IdP không có mật khẩu, ADR 0004): danh tính Google/GitHub chưa có tài khoản thì chọn username rồi tạo tài khoản mới; danh tính đã liên kết thì đăng nhập vào tài khoản đó. Xong thì IdP quay về `redirect_uri` với `code` như một lần đăng nhập bình thường; callback xử lý y hệt.
- Trên trang đăng ký có "Đã có tài khoản? Đăng nhập" (giữ nguyên request, không quay về app); nút Google/GitHub dùng đúng luồng liên kết/tạo tài khoản của trang đăng nhập. Mọi luật cũ vẫn áp dụng: giới hạn tần suất, CSRF.
- `prompt=create none` (hay `none` đi cùng bất kỳ giá trị nào) bị trả về `redirect_uri` với `error=invalid_request`. Không gửi `prompt` thì luồng không đổi (trang đăng nhập với nút Google/GitHub; lần đầu đăng nhập bằng một danh tính mới cũng tạo tài khoản).

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
| `profile` | `preferred_username`, `name`, `picture`, `telegram_linked` | ID token, userinfo |
| `email` | `email`, `email_verified` (`true` chỉ khi Google/GitHub xác minh) | ID token, userinfo |
| `telegram` (chỉ `localman-web`) | `telegram_chat_id` (chuỗi), `telegram_username` (không có `@`, có thể thiếu) | **chỉ userinfo**, và chỉ khi đã liên kết |

### Chat Telegram cho thông báo của Localman

- Localman xin thêm scope `telegram` khi đăng nhập (`scope: "openid profile email telegram"`). Là client first-party nên IdP **không hiện trang consent** cho scope này (như mọi scope khác của `localman-web`); trang `/account` của IdP cho user thấy và gỡ liên kết Telegram bất cứ lúc nào. Client khác (`tunelo-*`, `hoandat-account`, client MCP) xin `telegram` thì nhận `invalid_scope`.
- Gọi `userinfo_endpoint` bằng access token opaque của phiên: có `telegram_chat_id` thì gửi thông báo tới chat đó bằng bot riêng của Localman; không có (chưa liên kết hoặc đã gỡ) thì hiện nút "Liên kết Telegram" dẫn tới `${issuer}/account`. Claim không bao giờ nằm trong ID token hay access token JWT, nên đừng tìm nó ở `tokens.claims()`.
- Bot của Localman chỉ nhắn được cho user đã từng bấm Start với **chính bot đó** (Telegram trả 403 "bot can't initiate conversation" nếu chưa). `telegram_chat_id` là chat riêng giữa user và bot của IdP, có cùng giá trị với id người dùng Telegram, nên dùng được cho bot Localman sau khi user mở `t.me/<bot Localman>` và bấm Start; gặp 403 thì nhắc user làm việc đó.
- Chat có thể đổi (liên kết lại chat khác) hoặc bị gỡ. Localman phải đọc lại `userinfo` (a) mỗi lần đăng nhập, (b) mỗi lần refresh access token, và (c) khi nhận sự kiện audit `method.linked` hoặc `method.unlinked` với `method: "telegram"` (mục 10) của user đó; khi đó xoá chat cũ đã lưu. Không gửi gì tới chat cũ sau khi `userinfo` không còn trả nó.

## 5. Back-channel logout (Localman web, Tunelo web)

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
- **Phiên trượt 30/90 ngày**: mỗi lần refresh thành công, grant được gia hạn tới 30 ngày sau lần đó, nhưng không quá 90 ngày kể từ lúc đăng nhập. Không refresh quá 30 ngày thì phải đăng nhập lại; tới ngày 90 thì luôn phải đăng nhập lại ở app web. Riêng thiết bị Tunelo CLI (`tunelo-cli`) không có trần 90 ngày: còn refresh trong 30 ngày là phiên còn mãi (thu hồi từng máy ở `/account`).
- `localman-web`, `tunelo-web` và client MCP không có `offline_access` (client MCP xin thì bị bỏ qua, mục 9): refresh token của chúng gắn với phiên trình duyệt ở IdP (đăng xuất ở IdP là hết), vẫn theo trần 30/90 ngày.
- `revocation_endpoint`: client chỉ thu hồi được token của chính nó. Thu hồi refresh token thu hồi cả grant (`tunelo logout`); thu hồi access token làm mọi token của grant mất hiệu lực nhưng giữ grant.

## 9. Client MCP (Localman MCP)

- Localman công bố Protected Resource Metadata với `authorization_servers: ["https://auth.hoandat.com"]` và `resource: "https://localman.hoandat.com/mcp"`.
- Client đăng ký qua `registration_endpoint`: redirect chỉ `https://…` hoặc `http://localhost`/`http://127.0.0.1`; scope chỉ trong `mock:*`, `client:*`, `credentials:write` (bỏ trống `scope` thì nhận `mock:*` và `client:*`, không có `credentials:write`; scope khác bị `invalid_client_metadata`); `client_name` (nếu có) dài 1–100 ký tự, không chứa ký tự điều khiển, xuống dòng hay ký tự định hướng bidi (vi phạm thì `invalid_client_metadata`); không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP tối đa 20 đăng ký mỗi giờ.
- `client_name` là tên tự khai và **không bị từ chối vì nội dung**: client MCP thường ghép tên server người dùng đặt vào tên mình (Claude Code đăng ký `"Claude Code (localman)"`), nên tên chứa `localman`, `tunelo`, `hoandat` hay bản nhái (chữ Cyrillic/Greek, `LocaIman`, `L o c a l m a n`…) vẫn đăng ký được. Chống mạo danh nằm ở các trang IdP thay vì lúc đăng ký:
  - Trang consent (luôn hiện với client DCR) đặt tên trong ngoặc kép như dữ liệu người dùng nhập, gắn nhãn "Ứng dụng bên ngoài" và khối cảnh báo "Ứng dụng bên ngoài, không do hoandat.com phát hành"; tên trông giống sản phẩm first-party có thêm cảnh báo đỏ "Tên ứng dụng giống sản phẩm của hoandat.com nhưng không phải".
  - Consent hiện host của `redirect_uri` trong chính request này (vd. `localhost:53682` với Claude Code), để người dùng biết mã cấp quyền được gửi về đâu.
  - Trang đăng nhập, xác nhận đăng xuất và danh sách "Ứng dụng đã cấp quyền" ở `/account` cũng ghi tên client DCR trong ngoặc kép kèm nhãn ứng dụng bên ngoài. Client tĩnh (`localman-web`, `tunelo-*`, `hoandat-account`) hiển thị như cũ.
- Authorization request phải có `resource=https://localman.hoandat.com/mcp` (resource khác bị `invalid_target`); user luôn thấy trang consent nói trên, kể cả khi đã cấp quyền trước đó.
- `offline_access`: SDK MCP (vd. TypeScript SDK 2.x) tự thêm scope này vào đăng ký và authorization request (kèm `prompt=consent`) khi discovery quảng bá nó. IdP **lặng lẽ bỏ** `offline_access` của client DCR thay vì báo lỗi: lúc đăng ký nó không vào `scope` lưu của client (response đăng ký trả `scope` đã bỏ nó), lúc authorize (`GET /auth`) nó bị gỡ khỏi `scope` trước khi kiểm. Chỉ `offline_access` được bỏ qua: scope ngoài danh sách trên vẫn bị `invalid_client_metadata` lúc đăng ký, scope client chưa đăng ký (vd. `credentials:write` khi chưa khai) vẫn bị `invalid_scope` lúc authorize. Client MCP vẫn nhận refresh token như cũ, gắn phiên IdP (mục 8). Authorization request gửi bằng `POST /auth` hoặc PAR không được gỡ: client DCR dùng hai cách đó thì đừng xin `offline_access`. Client tĩnh không có scope này (`localman-web`) vẫn nhận `invalid_scope`.
- Endpoint MCP xác minh như mục 3 với `aud=https://localman.hoandat.com/mcp`.
- Link từ app sang trang tài khoản dùng neo cố định: `${issuer}/account#account-email`, `#account-sign-in` (cách đăng nhập: liên kết/huỷ Google, GitHub), `#account-apps` (danh sách ứng dụng đã cấp quyền, nơi user thu hồi client MCP). `#account-password` và `#account-recovery` đã bỏ cùng mật khẩu và mã khôi phục (ADR 0004); link cũ chỉ mở đầu trang.

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
| `login.succeeded` | `methods` (amr: `fed`, đăng nhập qua Google/GitHub) |
| `method.linked`, `method.unlinked` | `method` (`google`, `github`, `telegram`). Liên kết lại sang chat Telegram khác cũng sinh `method.linked`; Localman đọc lại `userinfo` khi nhận sự kiện có `method: "telegram"` |
| `email.reclaimed` | (tài khoản `sub` mất email chưa xác minh cho chủ đã xác minh) |
| `grant.created` | `clientId`, `kind` (`device`: duyệt máy Tunelo, có `deviceName`; `third-party-app`: consent client MCP). App first-party đăng nhập không sinh sự kiện này |
| `session.revoked`, `grant.revoked` | `count`, `cause` (`account-page`, `token-revocation`: client thu hồi refresh token ở `revocation_endpoint`), có thể có `clientId` |
| `session.logout` | `scope` (`all`: đăng xuất khỏi IdP; `client`: chỉ khỏi một app), có thể có `clientId` (RP-initiated logout) |

`ip`, `user_agent` có khi sự kiện đến từ một request của user; sự kiện nằm chờ quá 30 ngày (Localman chưa nhận) bị xoá hai trường này trước khi gửi. Sự kiện đã gửi được giữ 30 ngày trong outbox rồi tự xoá. Payload không bao giờ chứa mã, token, link hay secret. Từ khi bỏ mật khẩu (ADR 0004) IdP không còn phát `login.failed`, `login.locked`, `password.changed`, `password.reset`, `recovery_codes.regenerated`, và `cause` không còn `password-change`, `password-reset`, `security-review`; sự kiện cũ loại đó đã nằm trong outbox vẫn được gửi. Thứ tự gửi theo lúc xảy ra (cũ trước), nhưng thử lại có thể làm sự kiện tới không theo thứ tự: sắp theo `toe`.

**Localman phải**

1. Kiểm `Authorization: Basic` bằng cách base64-decode rồi tách ở dấu `:` **đầu tiên** (id không bao giờ chứa `:`; secret có thể chứa `+/=` và gửi nguyên văn, không URL-encode), so sánh constant-time với cặp đã cấu hình.
2. Xác minh JWS bằng JWKS của IdP: `jwtVerify(body, jwks, { issuer, audience: "https://localman.hoandat.com/internal/audit-events", algorithms: ["ES256"], typ: "secevent+jwt" })` (`aud` là URL đầy đủ của endpoint, đúng giá trị `AUDIT_EVENTS_URL` của IdP). Mỗi lần thử lại được ký lại, `exp` là 10 phút sau lúc ký, nên `jose` tự từ chối SET cũ; `toe` là lúc sự kiện xảy ra.
3. Bỏ trùng theo `jti` (bằng `Idempotency-Key`): IdP có thể gửi lại một sự kiện đã nhận nếu phản hồi lần trước bị mất; lần trùng vẫn trả 2xx.
4. Trả `202` (hoặc 2xx bất kỳ) khi đã lưu. Mọi phản hồi khác làm IdP thử lại sau 5 giây, nhân đôi mỗi lần, trần 1 giờ, **không bao giờ bỏ** sự kiện; IdP không đọc body phản hồi.

## 11. Tenant khác `hoandat.com` (ADR 0006)

IdP phục vụ thêm tenant theo domain: tenant `<d>` có issuer `https://auth.<d>`, audience `https://localman.<d>`, `https://localman.<d>/mcp`, `https://tunnel.<d>`, cùng client id (`localman-web`, `tunelo-cli`, `tunelo-web`). Tenant `hoandat.com` không đổi gì ở mục 1–10; app giữ cấu hình tĩnh cho nó và không cần IdP lúc chạy.

**API nội bộ** (chỉ trên loopback của máy chạy IdP, `INTERNAL_HOST:INTERNAL_PORT`, mặc định `127.0.0.1:4501`; không bao giờ qua nginx). Mỗi app có Basic credentials riêng (`localman:<secret>`, `tunelo:<secret>` trong `INTERNAL_API_CREDENTIALS` của IdP). Không endpoint nào trả secret.

| Endpoint | Trả |
|---|---|
| `GET /internal/tenants/lookup?host=<Host>` | `{ id, domain, displayName, issuer, status, resources, webApps }` cho mọi host của tenant (`auth.`, `localman.`, `<x>.localman.`, `tunnel.`, `<x>.tunnel.`); `404` khi không có tenant đang phục vụ (tenant bị đình chỉ cũng 404) |
| `GET /internal/tenants/<id>/jwks` | JWKS công khai của tenant |
| `GET /internal/tenants/<id>/openid-configuration` | discovery của tenant, đúng như `https://auth.<d>/.well-known/openid-configuration` |

App lấy JWKS và discovery của tenant qua API này, **không** phân giải `auth.<d>` qua DNS công khai (domain của tenant do người khác giữ DNS). Cache theo tenant, dùng bản cũ khi IdP lỗi; chỉ cache âm khi IdP trả `404`.

**Secret client của tenant mới** không được cấp qua API nào: app tự tính `base64url(HMAC-SHA256(<khoá của app>, "<tenantId>"))`. Khoá của app do IdP suy ra từ khoá gốc và giao một lần (`node --env-file=.env dist/app-client-key.mjs localman-web <file>`, tương tự `tunelo-web`); Localman chỉ giữ khoá của `localman-web`, Tunelo chỉ giữ khoá của `tunelo-web`. Xoay khoá gốc là xoay mọi secret suy ra cùng lúc.

**Audit:** sự kiện của mọi tenant gửi tới cùng một intake `AUDIT_EVENTS_URL` (mục 10), với cùng Basic credentials và `aud` là URL đó; mỗi SET ký bằng khoá của tenant với `iss = https://auth.<d>`. Localman phân biệt tenant bằng `iss` và xác minh bằng JWKS của tenant lấy qua API nội bộ (tenant chính: JWKS công khai như cũ).

## 12. Chưa làm ở IdP

- **Lookup workspace** (`GET {LOCALMAN}/internal/users/:sub/workspaces`, client credentials, cache 60 giây): IdP chưa có tính năng nào cần nó (trang service account thuộc plan devops phase 01), nên chưa gọi. Khi làm, IdP coi Localman là nguồn duy nhất và không lưu danh sách workspace.
- Service account và grant `client_credentials` (plan devops phase 01): khi có, Tunelo dùng nó để gọi API nội bộ của Localman.
