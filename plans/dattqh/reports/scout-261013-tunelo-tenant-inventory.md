# Tunelo: kiểm kê cho đa tenant (chỉ đọc, 13/10/2026)

Nguồn: agent Explore chỉ đọc trên `localman-next` (apps/tunelo-server, packages/tunelo-cli, packages/tunelo-shared, infra/tunelo, docs/tunelo). Chưa kiểm DB thật hay nginx thật ngoài phần đã đọc trên .65.

## Dữ liệu (mongoose, không có lớp repository)
| Collection | Model | Khoá | Index |
|---|---|---|---|
| `apikeys` | `db/models/api-key-model.ts` | `keyHash`, `_id`, `deviceId`, `linkedDeviceId` | `keyHash` unique |
| `linkrequests` | `db/models/link-request-model.ts` | `requestId`, `codeHash` | hai unique, TTL `expiresAt` |
| `loginrequests` | `db/models/login-request-model.ts` | `requestId` | unique, TTL |
| `usagelogs` | `db/models/usage-log-model.ts` | `{keyId,userId,date}` upsert | không unique |
| `web_sessions` | `web/web-session-model.ts` | `_id` = SHA-256 cookie, `sub`, `sid` | TTL |

## Trạng thái trong bộ nhớ / Valkey (chưa có tenant)
Tunnel map theo `subdomain` (`tunnel-manager.ts:57`), orphan/grace timer, pending request, stream registry; cache Valkey `tunelo:cache:{subdomain}:…` và purge theo subdomain; cổng TCP một dải toàn cục, `buildTcpUrl` dùng domain chính; usage buffer theo `keyId:date`; limiter link theo `keyId`; rate limit theo IP.

## Domain, auth, web, CLI
- `config/tunnel-domains.ts`: `TUNNEL_DOMAINS`, `buildTunnelUrl`/`buildTcpUrl` dùng domain chính; `request-relay.ts:20-36` `extractSubdomain`.
- Một verifier IdP cho cả process (`server.ts:27-35`, `auth/idp-token-verifier.ts`): một issuer, một audience, JWKS `${issuer}/jwks`.
- Web console: một client `tunelo-web`, một `publicUrl`, secret `TUNELO_WEB_CLIENT_SECRET`, back-channel logout một issuer; i18n có "hoandat".
- CLI: `ACCOUNT_SERVER_HOSTS` allowlist; hai `DEFAULT_SERVER_URL` (`server-url.ts`, `portal/api/client.ts`); `idp-client.ts` hardcode issuer/resource hoandat; refresh và device login gửi `resource` cố định; `tunelo login` không có `--server`.

## Rủi ro chính
Va chạm subdomain giữa tenant (tunnel, cache, purge); một verifier; CLI xin `resource` cố định; allowlist host thay vì ràng buộc server ↔ issuer; `LinkRequest.codeHash` unique toàn cục; token ẩn danh `tunelo_` không có tenant (gán tenant chính); TCP dải cổng chung.

## Chia sub-phase
06a package dùng chung `@localman/tenancy` (context, plugin, cache, loopback fetch) cho cả Localman và Tunelo; 06b dữ liệu Tunelo theo tenant; 06c Host → tenant, domain, cache, TCP; 06d auth theo tenant (verifier, web console); 06e web branding; 06f CLI theo server; 06g infra/docs.
