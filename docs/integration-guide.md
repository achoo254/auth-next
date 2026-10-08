# Hướng dẫn tích hợp với `auth.hoandat.com`

Tài liệu cho Localman web, Localman MCP, Tunelo CLI, Tunelo web và Localman (nhận audit). Quyết định phía IdP: [ADR 0001](decisions/0001-own-oidc-idp.md), [ADR 0002](decisions/0002-accounts-and-login-pages.md), [ADR 0003](decisions/0003-token-exchange-and-audit-outbox.md).

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

| `client_id` | Loại | Luồng | Scope được phép | `aud` của access token | Back-channel logout |
|---|---|---|---|---|---|
| `localman-web` | confidential (`client_secret_basic`) | Code + PKCE, refresh (gắn phiên IdP), **token exchange** | `openid profile email` + scope API Localman (không có `offline_access`) | `https://localman.hoandat.com` (chỉ khi xin scope API); đổi được token `https://tunnel.hoandat.com` | `https://localman.hoandat.com/auth/backchannel-logout` |
| `tunelo-cli` | public (`none`) | Device flow, refresh | `openid offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` | không |
| `tunelo-web` | confidential (`client_secret_basic`) | Code + PKCE, refresh | `openid profile email offline_access tunnels:open tunnels:read` | `https://tunnel.hoandat.com` | `https://tunnel.hoandat.com/auth/backchannel-logout` |
| client MCP (DCR) | public hoặc confidential | Code + PKCE, refresh | `mock:read mock:write client:read client:write client:send` | luôn `https://localman.hoandat.com/mcp` | không được khai |
| `hoandat-account` | nội bộ IdP | không dùng ngoài IdP | | | |

Redirect URI: `${LOCALMAN_WEB_URL}/auth/callback`, `${TUNELO_WEB_URL}/auth/callback`; post-logout về `/` của app. PKCE (`S256`) bắt buộc với **mọi** client, kể cả confidential.

**`aud` chính xác** (so khớp nguyên chuỗi, không `/` cuối):

| Resource server | `aud` | Scope |
|---|---|---|
| API Localman | `https://localman.hoandat.com` | `mock:*`, `client:*` |
| MCP của Localman | `https://localman.hoandat.com/mcp` | `mock:*`, `client:*` |
| API Tunelo | `https://tunnel.hoandat.com` | `tunnels:open`, `tunnels:read` |

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

## 5. Back-channel logout (Localman web, Tunelo web)

Khi user đăng xuất ở IdP hoặc phiên IdP bị thu hồi (ở `/account`, sau đặt lại mật khẩu), IdP `POST` form `logout_token=<JWT>` tới URI back-channel của client. App phải:

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
- Lỗi: client khác hoặc client không được phép thì `unauthorized_client`; sai secret thì `invalid_client` (401); `resource`/`audience` khác Tunelo thì `invalid_target` (thiếu cả hai thì `invalid_request`); scope khác `tunnels:read` thì `invalid_scope`; subject token sai loại, hết hạn, đã thu hồi, grant đã bị thu hồi (đăng xuất, đặt lại mật khẩu), tài khoản bị khoá hay đang chờ rà soát bảo mật thì `invalid_request` (RFC 8693 §2.2.2). Gặp `invalid_request` vì subject token thì coi như phiên đã chết: đăng nhập lại.
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

- Trang duyệt luôn hỏi "Cho phép `tunelo` trên máy <device_name>?"; đã đăng nhập IdP thì không hỏi mật khẩu. Mỗi máy một grant, thu hồi từng máy ở `/account`.
- Lưu refresh token với quyền file `0600`. `tunelo logout`: gọi `revocation_endpoint` với refresh token rồi xoá file.

## 8. Refresh token và phiên trượt

- Refresh token **dùng một lần, xoay vòng**: mỗi lần refresh nhận token mới; đưa lại token cũ làm IdP thu hồi cả grant. Hai refresh song song cùng một token thì một cái nhận `invalid_grant`. Vì vậy **phải khoá khi refresh** (Tunelo CLI: file lock vì nhiều tiến trình; app web: mutex theo phiên) và ghi token mới trước khi nhả khoá.
- **Phiên trượt 30/90 ngày**: mỗi lần refresh thành công, grant được gia hạn tới 30 ngày sau lần đó, nhưng không quá 90 ngày kể từ lúc đăng nhập. Không refresh quá 30 ngày thì phải đăng nhập lại; tới ngày 90 thì luôn phải đăng nhập lại (`tunelo login`, hoặc đăng nhập lại ở app web).
- `localman-web` và client MCP không có `offline_access`: refresh token của chúng gắn với phiên trình duyệt ở IdP (đăng xuất ở IdP là hết), vẫn theo trần 30/90 ngày.
- `revocation_endpoint`: client chỉ thu hồi được token của chính nó. Thu hồi refresh token thu hồi cả grant (`tunelo logout`); thu hồi access token làm mọi token của grant mất hiệu lực nhưng giữ grant.

## 9. Client MCP (Localman MCP)

- Localman công bố Protected Resource Metadata với `authorization_servers: ["https://auth.hoandat.com"]` và `resource: "https://localman.hoandat.com/mcp"`.
- Client đăng ký qua `registration_endpoint`: redirect chỉ `https://…` hoặc `http://localhost`/`http://127.0.0.1`; scope chỉ trong `mock:*`, `client:*`; `client_name` không được giả tên first-party; không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP tối đa 20 đăng ký mỗi giờ.
- Authorization request phải có `resource=https://localman.hoandat.com/mcp` (resource khác bị `invalid_target`); user luôn thấy trang consent "Ứng dụng bên thứ ba chưa xác minh".
- Endpoint MCP xác minh như mục 3 với `aud=https://localman.hoandat.com/mcp`.

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
      "methods": ["pwd"],
      "ip": "203.0.113.7",
      "user_agent": "Mozilla/5.0 ..."
    }
  }
}
```

| Loại (`urn:hoandat:auth:event:` + …) | Dữ liệu |
|---|---|
| `login.succeeded` | `methods` (amr: `pwd`, `fed`) |
| `login.failed` | `method` (`password`, `recovery-code`, `federated`), `reason` (`invalid`: bí mật sai; `review-pending`: Google/GitHub bị từ chối lúc chờ rà soát), có thể có `provider`; chỉ khi tài khoản tồn tại. Lượt bị khoá từ chối (không kiểm bí mật) không sinh sự kiện |
| `login.locked` | `method`; một lần, khi lượt sai cuối cùng vừa khoá tài khoản |
| `password.changed` | (đổi ở `/account`) |
| `password.reset` | `via` (`recovery-code`, `reset-link`) |
| `recovery_codes.regenerated` | |
| `method.linked`, `method.unlinked` | `method` (`google`, `github`, `telegram`) |
| `email.reclaimed` | (tài khoản `sub` mất email chưa xác minh cho chủ đã xác minh) |
| `grant.created` | `clientId`, `kind` (`device`: duyệt máy Tunelo, có `deviceName`; `third-party-app`: consent client MCP). App first-party đăng nhập không sinh sự kiện này |
| `session.revoked`, `grant.revoked` | `count`, `cause` (`account-page`, `password-change`, `password-reset`, `security-review`, `token-revocation`: client thu hồi refresh token ở `revocation_endpoint`), có thể có `clientId` |
| `session.logout` | `scope` (`all`: đăng xuất khỏi IdP; `client`: chỉ khỏi một app), có thể có `clientId` (RP-initiated logout) |

`ip`, `user_agent` có khi sự kiện đến từ một request của user; sự kiện nằm chờ quá 30 ngày (Localman chưa nhận) bị xoá hai trường này trước khi gửi. Sự kiện đã gửi được giữ 30 ngày trong outbox rồi tự xoá. Payload không bao giờ chứa mật khẩu, mã, token, link hay secret. Thứ tự gửi theo lúc xảy ra (cũ trước), nhưng thử lại có thể làm sự kiện tới không theo thứ tự: sắp theo `toe`.

**Localman phải**

1. Kiểm `Authorization: Basic` bằng cách base64-decode rồi tách ở dấu `:` **đầu tiên** (id không bao giờ chứa `:`; secret có thể chứa `+/=` và gửi nguyên văn, không URL-encode), so sánh constant-time với cặp đã cấu hình.
2. Xác minh JWS bằng JWKS của IdP: `jwtVerify(body, jwks, { issuer, audience: "https://localman.hoandat.com/internal/audit-events", algorithms: ["ES256"], typ: "secevent+jwt" })` (`aud` là URL đầy đủ của endpoint, đúng giá trị `AUDIT_EVENTS_URL` của IdP). Mỗi lần thử lại được ký lại, `exp` là 10 phút sau lúc ký, nên `jose` tự từ chối SET cũ; `toe` là lúc sự kiện xảy ra.
3. Bỏ trùng theo `jti` (bằng `Idempotency-Key`): IdP có thể gửi lại một sự kiện đã nhận nếu phản hồi lần trước bị mất; lần trùng vẫn trả 2xx.
4. Trả `202` (hoặc 2xx bất kỳ) khi đã lưu. Mọi phản hồi khác làm IdP thử lại sau 5 giây, nhân đôi mỗi lần, trần 1 giờ, **không bao giờ bỏ** sự kiện; IdP không đọc body phản hồi.

## 11. Chưa làm ở IdP

- **Lookup workspace** (`GET {LOCALMAN}/internal/users/:sub/workspaces`, client credentials, cache 60 giây): IdP chưa có tính năng nào cần nó (trang service account thuộc plan devops phase 01), nên chưa gọi. Khi làm, IdP coi Localman là nguồn duy nhất và không lưu danh sách workspace.
- Service account và grant `client_credentials` (plan devops phase 01): khi có, Tunelo dùng nó để gọi API nội bộ của Localman.
