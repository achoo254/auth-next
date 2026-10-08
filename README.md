# hoandat-auth

IdP OpenID Connect tự host tại `auth.hoandat.com`: một nơi đăng nhập cho Localman web, Localman MCP, Tunelo CLI và Tunelo web. Dựng trên [`oidc-provider`](https://github.com/panva/node-oidc-provider) v9, Express 5 và MongoDB. Lý do chọn kiến trúc: [`docs/decisions/0001-own-oidc-idp.md`](docs/decisions/0001-own-oidc-idp.md).

Trạng thái: phase 01 (lõi OIDC). Chưa có trang đăng nhập; mọi interaction trả 501 cho tới phase 02.

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
| `pnpm test` | Vitest; tự chạy một mongod thật qua `mongodb-memory-server` (lần đầu tải binary) |
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

Access token là JWT ES256 (`typ: at+jwt`) sống 15 phút. App xác minh offline bằng `jose` với JWKS đã cache, kiểm `iss`, `aud` của chính mình, `alg: ES256` và `typ`; mẫu tham chiếu: [`src/__tests__/helpers/verify-access-token.ts`](src/__tests__/helpers/verify-access-token.ts).

Khi request không có `resource`, IdP chỉ gắn audience nếu scope xin có ít nhất một scope của resource duy nhất mà client được phép (ví dụ `mock:read` cho Localman, `tunnels:read` cho Tunelo). Request chỉ có `openid profile email` nhận access token opaque, dùng được cho userinfo (`/me`).

### Lưu ý cho client
- **Refresh token dùng một lần và xoay vòng.** Mỗi lần refresh trả về refresh token mới; dùng lại token cũ sẽ thu hồi cả grant. Hai request refresh song song với cùng một token thì chỉ một cái thắng, cái còn lại nhận `invalid_grant`. Vì vậy client (đặc biệt Tunelo CLI chạy nhiều tiến trình) **phải khoá khi refresh** (file lock hoặc mutex) và lưu token mới trước khi nhả khoá.
- **Grant sống cứng 30 ngày** kể từ lúc đăng nhập, không được gia hạn khi refresh. Sau 30 ngày refresh sẽ hỏng và CLI phải chạy lại `tunelo login`; app web phải đưa user qua đăng nhập lại.
- `offline_access` chỉ có hiệu lực khi request kèm `prompt=consent` (OIDC Core).
- Introspection: client chỉ xem được token của chính mình; riêng `localman-web` và `tunelo-web` xem được mọi token. Token không được phép xem trả `{"active": false}`.

Client MCP đăng ký qua `/reg`: redirect chỉ được là `https://…` hoặc `http://localhost`/`http://127.0.0.1`; xin resource khác `/mcp` bị trả `invalid_target`. `client_name` chứa `localman`, `tunelo` hoặc `hoandat` (không phân biệt hoa thường) bị từ chối, và client không được khai `logo_uri`, `client_uri`, `policy_uri`, `tos_uri`, `backchannel_logout_uri`, `jwks_uri`, `sector_identifier_uri`. Mỗi IP đăng ký tối đa 20 client mỗi giờ.

## Cấu hình

Xem [`.env.example`](.env.example); env sai hoặc thiếu thì process báo tên biến và thoát với mã 1 (không in giá trị).

Ở production (`NODE_ENV=production`) process từ chối khởi động nếu `ISSUER`, `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL` không phải URL https công khai ghi rõ (không localhost), hoặc `TRUST_PROXY` vẫn là mặc định `loopback` hay `false`. `TRUST_PROXY` phải liệt kê **đúng địa chỉ** mà reverse proxy kết nối tới container (ví dụ IP của proxy trong mạng Docker) cùng từ khoá `cloudflare`, ví dụ `172.18.0.2,cloudflare`; đừng tin cả một dải mạng riêng, vì container nào trong dải đó cũng giả được IP client. File khoá mount read-only và phải đọc được bởi user `node` (uid 1000) trong container.

Request có Host khác host của `ISSUER` bị trả 421; thêm host phụ cho dev qua `ALLOWED_HOSTS`. Riêng `/healthz` trả lời mọi Host để healthcheck của container chạy được.

## Cấu trúc

```
src/server.ts                 # entry: env, Mongo, khoá ký, provider, listen, tắt êm
src/app.ts                    # Express: bảo mật, /healthz, /interaction, provider
src/config/                   # env (zod), trust proxy (gồm dải IP Cloudflare)
src/http/                     # helmet + rate limit + header proxy, placeholder 501, error handler
src/oidc/provider.ts          # cấu hình oidc-provider (TTL, cookie, feature, route)
src/oidc/clients.ts           # 3 client tĩnh
src/oidc/resources.ts         # audience, scope theo resource, chính sách resource
src/oidc/registration-policy.ts  # chính sách DCR cho client MCP
src/oidc/mongo-adapter.ts     # adapter MongoDB, TTL index theo expiresAt
src/oidc/jwks.ts, claims.ts   # khoá ES256 nhiều kid; claim và interface AccountStore
src/__tests__/                # test luồng bằng openid-client trên Mongo thật
```
