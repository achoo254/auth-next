# Review: localman-next tenant routing, per-tenant OIDC, web, nginx (cd39f37..0e54c9c) + hoandat-auth 7ae6161

## Code Review Summary

### Scope
- localman-next: cd39f37 (host to tenant, tenantSettings, tenant-keyed caches), 427448a (fixes from the data-layer review), 78c51dd (per-tenant OIDC, MCP, token exchange, audit routing), bfeabed (Telegram only for the primary tenant), e19e1b9 (`GET /tenant` and web), 0e54c9c (nginx and release scripts).
- hoandat-auth: 7ae6161 (`GET /internal/tenants/:id`).
- About 2,800 changed lines. Each commit was read through `git show` and a `git archive` of 0e54c9c, because another session edits the working tree.
- Method: read-only, as requested. I ran no tests, vitest, Playwright, mongod or nginx. Every finding comes from reading the code. `nginx -t` was not run.
- Scout: dependents of `tenantSettings()`/`currentTenant()` on paths without a tenant scope, every caller of `tenantDirectory()`, the IdP's `tenantDomainCandidates`/`SERVING_STATUSES`/HMAC derivation, the order in which conf.d loads, and how the release scripts are synced. The vitest setup file sets a default tenant for every test file, which masks missing-scope bugs (already flagged as M3 in the data-layer review). H1 is a concrete case of that.

### Overall Assessment
The design holds up. The primary tenant's hosts resolve without asking the IdP. Secrets, codes and JWKS never go through a tenant's DNS. Audit SETs are verified with the issuer's own per-tenant keys. Tests use the real loopback transport. I found no cross-tenant data or session leak in the request path.

Two problems block operations:
- Once tenants are enabled, the mock runtime's loopback `/healthz` returns 500, so every later deploy fails its health check.
- The new `switch-release.sh` cannot roll back to any release built before 0e54c9c, and it leaves a half-swapped nginx config on disk when it tries.

The rest are robustness issues around the IdP directory (flooding, stalls) and loop or masking checks that only know the current tenant's mock domain.

---

## Critical Issues
None found (no cross-tenant data, session or token leak in the request paths I reviewed).

## High Priority

### H1. Mock runtime `/healthz` on loopback returns 500 once tenants are enabled, so every deploy after that fails its health check
- Where:
  - `apps/api/src/tenancy/tenant-scope-middleware.ts:30-33` lets `/healthz` through with **no tenant scope**.
  - `apps/api/src/http/create-base-app.ts:69-81` registers `/healthz` after `beforeBody` and `mountRoutes`.
  - The mock app's `beforeBody` runs `readAddress` (`apps/api/src/modules/mock-runtime/mock-http.ts:51-56`), which calls `tenantSettings()` → `currentTenant()`, and that throws `MissingTenantError`.
- Scenario: `IDP_INTERNAL_URL` is set, so `createIdpTenantDirectory` is active. `switch-release.sh:82-85` runs `curl http://127.0.0.1:4100/healthz` with Host `127.0.0.1:4100`. `localmanDomainOf` rejects hosts with a port, so there is no tenant. `next()` runs outside any ALS store, `readAddress` throws, and the response is 500. `healthy()` never passes, the release is reported failed, and activate-release rolls back. The rollback's health check fails the same way: "ROLLBACK TO … FAILED". The dashboard (:4000) `/healthz` is unaffected because nothing before its `/healthz` reads the tenant.
- Why tests pass: `src/test-support/tenant-setup.ts` sets `setTestDefaultTenant(TEST_TENANT)` for every file, so `tenant-hosts.test.ts:135-142` ("except /healthz") gets the test tenant from `findCurrentTenant()`. Production never sets it.
- Fix: answer health before anything tenant-bound. Either answer `/healthz` directly inside `tenantScope` (`res.json({status:"ok", db:getDbState()})`), or register the `/healthz` route before `tenantScope` in `createBaseApp`. Add a test that calls `setTestDefaultTenant(undefined)` and hits `/healthz` on both apps with an IdP directory configured.

### H2. `switch-release.sh` cannot roll back to a release built before 0e54c9c, and it leaves a half-installed nginx config on disk when it tries
- Where: `infra/localman/switch-release.sh:34-54`. deploy.sh syncs `/opt/localman/infra` before activation, so `activate-release.sh:74-79` rolls back with the **new** script.
- Scenario (the first deploy of 0e54c9c fails its health check, or a manual rollback to any of the 4 older releases kept):
  1. The loop installs the old release's `localman.hoandat.com.conf` (self-contained, older CSP hashes) and writes a `.bak`.
  2. It then hits `[ -s "$src" ] || die "missing …/nginx/localman-app.inc"`. Old releases have no `localman-app.inc` and no `localman-tenants.conf`.
  3. `die` exits **without restoring** the files already swapped. Restoration only exists in the `nginx -t` failure branch.
  4. The symlink and pm2 stay on the failed release and nginx is not reloaded, so on-disk config and running config now differ.
  5. The next `systemctl reload nginx` (certbot `renew_hook`, an IdP deploy) loads the old CSP hashes against the new `web/` build. The primary dashboard's inline scripts are then blocked.
- Second scenario, once tenants are enabled: say a rollback did reach a pre-cd39f37 (or pre-d3a080f) API while `localman-tenants.conf` and `localman-app.inc` from the newer release stay installed.
  - nginx keeps routing every `localman.<d>` and `*.localman.<d>` host to an API with no tenant directory and no tenant filter.
  - The old unique indexes were dropped by `migrateToTenants(…, true)`, so `<secret>.localman.<any>` can serve another tenant's project with the same secret.
  - The deployment guide only warns that indexes need rebuilding.
- Fix:
  - Install a file only if the target release has it. When the target lacks `localman-app.inc`, its primary conf is self-contained: remove `/etc/nginx/conf.d/localman-tenants.conf` (backed up) instead of dying.
  - Restore every changed file on any failure (`trap … ERR`, or a single restore function used by both `die` paths).
  - Refuse, or require `--force` for, switching to a release without `api/create-tenant-indexes.mjs` while `/opt/localman/.env` has `IDP_INTERNAL_URL`.

## Medium Priority

### M1. Loop and secret-masking checks only know the current tenant's mock domain, which allows cross-tenant mock-to-mock loops and logs other tenants' secrets
- Where:
  - `apps/api/src/modules/mock-runtime/upstream-config.ts:70-76` (`isMockHost`, used by `normalizeBaseUrl` at :93).
  - `apps/api/src/modules/mock-callbacks/callback-config.ts:90`.
  - `apps/api/src/modules/api-client/proxy-operations.ts:43-50` (`loggedHost`).
- Before tenants there was one mock domain, so a mock could never forward or call back into a mock. Now tenant A's check only refuses `*.localman.A`.
- Scenario, loop:
  - Tenant A's mock X has upstream `https://localman.B/m/<Y>`, where B is a second tenant of the same attacker.
  - B's mock Y has upstream `https://localman.A/m/<X>`.
  - The attacker points `localman.A` and `localman.B` at a CDN or proxy in front of <SERVER_65_IP>. The SSRF guard sees a public CDN address and does not block it (the own-address rule does not apply).
  - The same works towards the primary through its Cloudflare-proxied `https://localman.hoandat.com/m/<secret>` fallback.
  - Each request bounces between the two runtimes until timeouts or per-secret limits stop it. Callbacks can chain the same way. The upstream path has no hop marker that the runtime refuses.
- Scenario, logs: a tenant user who proxies `https://<primary-secret>.localman.hoandat.com/` gets the full host, secret included, in the proxy log line. This breaks the "never log secrets" rule.
- Fix: one shared predicate "is any Localman dashboard or mock host" (the primary's dashboard and mock base, or `localmanDomainOf(host) !== undefined`), used by all three call sites. Optionally, add a dedicated upstream hop header and have the mock runtime refuse to forward a request that already carries it.

### M2. Any Host can drive unbounded IdP lookups and evict real tenants from the directory cache
- Where:
  - `apps/api/src/tenancy/tenant-answer-cache.ts:9,45-52`: 1,000 entries, insertion-order eviction, shared by positive answers, 404s and `id:` keys.
  - `apps/api/src/tenancy/idp-tenant-directory.ts:53-61`.
  - `infra/localman/nginx/localman-tenants.conf:66-92`: any `localman.<anything>` Host is proxied, and `/api/` has no `limit_req`.
- Scenario:
  - nginx picks the certificate by SNI but routes the request by Host. A client can use SNI `localman.hoandat.com` (valid certificate) and send `Host: localman.r<N>.com` for N = 1…∞.
  - Each request costs one IdP internal API call plus registry queries in the process that also serves `auth.hoandat.com`. There is no concurrency cap on misses.
  - Each also inserts a cache entry. Real tenants' entries are evicted, and with them their stale-while-error protection. During the next IdP restart those tenants get 503, and their background jobs throw (see M3).
- Fix:
  - In the tenant blocks, reject a Host that does not match SNI: `if ($host != $ssl_server_name) { return 421; }`. `return` is safe inside `if`, and `$host` is lowercased, so compare a lowercased SNI if needed. Only domains that hold an IdP-issued certificate then reach the API.
  - In the API, keep known tenants in a map that 404s cannot evict, cap concurrent IdP misses, and optionally require `answer.domain === domain` (L3).

### M3. When the IdP is down, the primary tenant's outbound queue stalls and expired jobs of other tenants are lost
- Where: `apps/api/src/modules/mock-callbacks/retry-queue.ts:98-102` and `:127-135`. This escalates L5 of the data-layer review: `byId` can now *throw*, not just return `undefined`.
- Scenario:
  - The IdP internal API is unreachable, and Localman restarted (or M2 evicted the entry) so tenant T's id is not cached.
  - `fill()` takes T's expired job (`findOneAndDelete`), and `inTenantOf` → `byId` throws.
  - The job is gone without `expireOutboundJob`, and `fill()` rejects before it claims any due job, including the primary's.
  - This repeats every poll while T has expired jobs, so primary callbacks wait behind them. That breaks "the primary never depends on the IdP at run time".
- Fix:
  - Resolve the tenant *before* deleting: read the expired candidate, resolve, then delete by `_id` inside the tenant.
  - Catch lookup failures per job and continue the loop, leaving the job for a later poll.

### M4. Stale-while-error still waits for the full lookup timeout on every request once the entry is past its TTL
- Where: `apps/api/src/tenancy/tenant-answer-cache.ts:59-78`. A failed refresh returns `known.answer` but never re-stamps the entry.
- Scenario: the IdP hangs (blocked event loop or slow Mongo) rather than refusing connections.
  - After 60 s, every request to a known tenant joins an in-flight lookup that times out after 3 s, gets the stale answer, and the next request starts another 3 s lookup.
  - `forEachTenant` (`each-tenant.ts:16-27`) runs tenants one after another, so the primary's periodic jobs wait N×3 s.
  - Staleness is also unbounded: a tenant suspended at the IdP keeps being served for as long as the internal API keeps failing.
- Fix:
  - On failure, re-store the old answer with a short retry back-off, e.g. `at = now - ttl + 5_000`. Better: serve stale at once and refresh in the background.
  - Cap staleness (for example 24 h).
  - In `forEachTenant`, run the primary first, or resolve ids concurrently.

### M5. In single-tenant mode, every `localman.<d>` host that nginx routes is served as the primary tenant
- Where:
  - `apps/api/src/tenancy/configure-tenancy.ts:16-18` and `tenant-directory.ts:29-34` (`byHost: async () => tenant`).
  - `infra/localman/switch-release.sh:39-41` installs `localman-tenants.conf` whenever the IdP's `00-tenants-http.conf` exists, whatever Localman's env says.
- Scenario: the documented window between step 1 (IdP installs the map, the next Localman release installs the tenant blocks) and step 2 (`IDP_*` env set). The same happens if the env is reverted later.
  - Any claimed domain with an IdP-issued certificate is served under `https://localman.<d>` and `https://<primary-secret>.localman.<d>` with the primary's data, landing page and MCP metadata.
  - That domain's owner controls its DNS, so a fully working copy of hoandat's Localman, with a valid certificate, runs on a third party's domain.
  - Sign-in does not complete there (the callback is on `PUBLIC_URL`, and `__Host-` cookies are host-only), so no session leaks. The primary's behaviour still changes in a way nobody intended.
- Fix (either):
  - (a) Have `singleTenantDirectory` return `undefined` for hosts where `localmanDomainOf(host)` names a non-primary domain, and keep serving loopback and dev hosts as before.
  - (b) Install `localman-tenants.conf` only when `/opt/localman/.env` has `IDP_INTERNAL_URL`.

## Low Priority

- **L1. On a tenant domain the web falls back to the primary's identity, with no retry.** In `apps/web/src/lib/tenant-info.ts:22-28,49-62`, if `/api/v1/tenant` fails once, `loading` stays `true`. The page then shows "hoandat account", links to `https://auth.hoandat.com/account`, and puts `https://localman.hoandat.com/mcp` in the MCP docs and config samples. The same appears until the first answer arrives. A user who copies the MCP config connects to the wrong tenant.
  - Fix: keep `getServerSnapshot` = DEFAULT, which still hydrates cleanly. Have `getSnapshot` derive a default from `location.host` (`localman.<d>` → `auth.<d>`, `localman.<d>`, `tunnel.<d>`), and retry the fetch once.
- **L2. Localman serves tenants still in `claimed` status.** The IdP's `SERVING_STATUSES` is `["claimed","active"]` (`hoandat-auth src/tenants/tenant-document.ts:57`). The internal lookup and the new `/internal/tenants/:id` return such tenants with `status`, but `idp-tenant-client.ts:8-15` drops `status`. ADR 0006 says a non-active tenant serves only `/admin`. Today the impact is a dashboard whose sign-in fails at the IdP. Fix: treat `status !== "active"` as 404 in `toTenant`, or have the IdP's app-facing lookups return active tenants only.
- **L3. The directory accepts an answer for a different domain.** The IdP tries both candidates (`localman.localman.foo.com` → `localman.foo.com`, then `foo.com`). So `byHost("localman.localman.foo.com")` caches `domain:localman.foo.com` → tenant `foo.com`, while nginx routes that same host to the mock block. Harmless today. Fix: in `idp-tenant-directory.ts:58-61`, drop an answer whose `domain` differs from the requested one.
- **L4. Transport env is looser than the comments.**
  - `IDP_LOOPBACK_URL` accepts `https`, but `loopback-fetch.ts` uses `node:http` `request`, so sign-in would fail with `Protocol "https:" not supported`.
  - `IDP_INTERNAL_URL` is described as "loopback only" but any host is accepted, so a misconfiguration would send the Basic secret in cleartext.
  - Fix: restrict both to `http://127.0.0.1`, `[::1]` or `localhost` in `config/tenant-env.ts:10-27`, as the IdP's own `tenants-env.ts` does.
- **L5. Tenant DNS now decides when the SSRF own-address exemption applies.** `runtime-ssrf-guard.ts:15-16` plus `ssrf-guard.ts:179-185`.
  - For a tenant's `*.localman.<d>` and `*.tunnel.<d>`, the guard skips the server's own addresses and `PROXY_BLOCKED_CIDRS` based on DNS the tenant owner controls.
  - This is safe only while nginx on those addresses routes every such forced Host to a tenant block.
  - `tunnel.<d>` is offered as a tenant tunnel domain, but no Tunelo tenant block exists on .65, so those requests reach the 443 default server, where TLS verification fails.
  - Fix: apply `extraBlocked` to every host (the operator list is "never connect"), and do not offer `tunnel.<d>` until Tunelo serves tenants.
- **L6. Comment accuracy and repo rules.**
  - `localman-mcp-server.ts:53-54`: two stacked JSDoc blocks on `publicUrl`, and the first one (`PUBLIC_URL`) is stale.
  - `audit-events-route.ts:127`: a run-on comment line.
  - `config/env.test.ts`: 228 lines, over the 200 cap. It was already 212 before these commits.
  - `TunnelTokenExchange` caches by bare `sessionId`. Safe because ids are random and `findById` is tenant-scoped, but it does not follow ADR item 9 (`tenantKey`).

## Edge Cases Found by Scout
- `/healthz` on an unknown host is the only path that runs without a tenant. The mock app's `beforeBody` reads the tenant there (H1).
- `activate-release.sh` rolls back with the infra copy synced by `deploy.sh`, which is always the newest script (H2).
- nginx re-selects the server by Host after the TLS handshake, so the certificate map limits SNI, not Host (M2).
- The IdP's `tenantDomainCandidates` tries two candidates in order (L3). Its `SERVING_STATUSES` includes `claimed` (L2).
- The upstream forwarder adds `X-Localman-Proxy`, but no mock path refuses it, so `isMockHost` is the only loop guard (M1).

## Verified Fine
- **The primary never asks the IdP on the request path.**
  - `isPrimaryHost` and `underPrimary` come before any lookup.
  - `byId("primary")` is static.
  - The primary's OIDC client, MCP settings (`tenantMcpSettings`), `tenantSettings()` (env runtime settings) and audit routing (`iss === currentTenant().issuer`, or a host-derived primary) are unchanged.
  - Exceptions: M3 (outbound queue) and M4 (job ordering).
- **Per-tenant OIDC.**
  - Discovery comes from the internal API, with `issuer === tenant.issuer` checked.
  - JWKS comes from the internal API with Basic auth; per-tenant keys come from `tenantSigningKeys` at the IdP.
  - Token, userinfo and exchange calls go through `loopbackFetch`, which refuses any origin other than `https://auth.<d>` and sets the tenant Host and `X-Forwarded-Proto: https`.
  - The client secret is `base64url(HMAC-SHA256(key string, tenantId utf8))`, identical to `hoandat-auth src/tenants/app-client-secrets.ts`.
  - The redirect URI is the tenant's own; the callback URL is built from `oidc.redirectUri`.
  - The token exchange resource is `https://tunnel.<d>`, matching the IdP's tenant resource policy.
  - Tests exercise the real loopback transport (`testing/tenant-auth-harness.ts:57`).
- **MCP:** `jwtVerify` with the tenant's discovered issuer and `aud = https://localman.<d>/mcp`. Protected-resource metadata and the resource URL are read per request.
- **Audit routing:**
  - Basic credentials are checked before the body is read.
  - `iss` → `auth.<d>` → tenant; the SET is verified inside `runInTenant` with that tenant's issuer and JWKS, and `aud` = the shared intake (integration guide §11).
  - Per-tenant signing keys mean tenant A's IdP keys cannot produce an event that is applied to tenant B.
  - The `jti` dedup and the event handlers run in that tenant.
  - Tenant `/internal/` returns 404 in nginx.
- **Sessions and CSRF:**
  - Cookies are `__Host-` and host-only per tenant origin, session SameSite=Strict.
  - Session lookup is tenant-scoped.
  - The primary's origins accepted on tenant hosts are harmless, since cross-site Strict cookies are not sent.
- **Caches and context:**
  - `tenantKey` covers project-by-secret, Mock MCP tools, enqueue chains, mock limits and known subjects.
  - `AsyncResource.bind` is applied to the request-log `finish`/`close` listeners and the inbox `finish` listener.
  - SSE heartbeats are timers created in the request, so they keep the context.
- **Telegram and owner alerts:** gated per tenant; `alertOwner` is only reached through the gated throttle; notification links are relative.
- **Web:**
  - `useSyncExternalStore` uses `getServerSnapshot` = DEFAULT and stable snapshot references, so hydration matches the prerender.
  - The API base stays same-origin (`VITE_API_BASE_URL=""`).
  - No `hoandat` literal is left in the i18n messages.
- **nginx syntax and semantics** (by reading; `nginx -t` not run):
  - Named captures in regex `server_name` are valid, and `$tenant` is defined before it is used in `add_header`.
  - Variables in `ssl_certificate` are fine (the IdP's `tenant-auth.conf` already relies on them). `$tenant_cert` comes from `00-tenants-http.conf`, which loads first.
  - Load order: `localman-http.conf` (zones, `log_format localman`) sorts before `localman-tenants.conf`.
  - Precedence: exact and wildcard names for `*.localman.hoandat.com` beat the regex blocks; the reserved-name regex is declared before the mock regex.
  - There is no duplicate `/internal/` location.
  - Server-level `proxy_set_header` from the include also applies to the primary's `/internal/`.
  - `X-Forwarded-Host $host` is always overwritten, so `TRUST_PROXY=127.0.0.1` stays sound.
  - The include path is outside `conf.d`, so the include is never loaded on its own.
  - deploy.sh fills the CSP placeholder in both files.
- **hoandat-auth 7ae6161:**
  - The route is registered after `/lookup`, behind the `localman`/`tunelo` roles.
  - It returns 404 for tenants that no longer serve, and no secret fields (`tenantSummary`).
  - A test covers it, and the integration guide row is updated.
- **427448a:** `refuseTenantChange` covers `$unset`/`$rename`/pipeline, `prefixIndexes` renames named indexes to `tenant_<name>`, the trimmer runs per tenant, and the rate-limit `_id` carries the tenant.
- **Rules:** none of the diffs add `any`, `!`, `console.log` or default exports, and imports use the ESM `.js` extension.

## Recommended Actions
1. H1: answer `/healthz` before tenant-bound middleware, and add a test with the default tenant cleared. Do this before setting `IDP_INTERNAL_URL` on prod.
2. H2: make `switch-release.sh` handle releases without the new nginx files, restore the config on every failure, and guard rollback to pre-tenant API releases.
3. M1: one "any Localman host" predicate for upstream, callbacks and log masking.
4. M2: add the SNI = Host check in the tenant nginx blocks, and protect positive cache entries from eviction.
5. M3, M4: resolve the tenant before deleting expired jobs and isolate per-job failures; re-stamp stale entries and cap staleness.
6. M5: gate either the single-tenant directory or the install of `localman-tenants.conf` on the tenant env.
7. L1-L6 as convenient. L2 and L4 are a few lines each.

## Metrics
- Type coverage, test coverage and lint count were not measured (read-only review; the user asked me not to run any suites).
- Banned-pattern grep over the five API/web commits found 0 `any`, 0 `!` assertions, 0 `console.log` and 0 default exports.
- Files over 200 lines among the changed files: 1 (`config/env.test.ts`, 228, already over before).

## Unresolved Questions
- Which server block is the first `listen 443` on .65 (`nginx -T | grep -n "listen .*443"`)? If `localman-tenants.conf` became the default 443 server, clients without SNI would get a failed handshake (`$tenant_cert` = `none`).
- Tenant owners pass `ownerOnly` (trial approvals and extensions, pro-interest and contact admin). Is it intended that a tenant owner can grant their users trial plans on the shared deployment's quotas?
- On the IdP side, outside these commits: back-channel logout POSTs for tenant clients go to `https://localman.<d>` through the tenant's public DNS. Does the IdP route them through loopback or an SSRF guard?

Status: DONE_WITH_CONCERNS
Summary: Found no cross-tenant data or session leak. Two problems block operations: once tenants are enabled, the mock `/healthz` returns 500 and every deploy fails its health check; and the new `switch-release.sh` cannot roll back to an older release and leaves a half-swapped nginx config. There are five medium issues: cross-tenant mock loops and unmasked secrets in logs, flooding of the IdP directory, outbound-queue stalls and slow stale fallback when the IdP is down, and the primary being served on tenant hosts in single-tenant mode.
