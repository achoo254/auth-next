# Code Review: Tunelo per tenant + `@localman/tenancy` extraction

Date: 2026-10-13 (Asia/Saigon). Repo: `/Users/hoandat/inet-gitlab/localman-next`, commits on `main`:
`d935942` (retire tunnel.inetdev.io.vn), `412291d` (extract `packages/tenancy`), `a2bfca0` (Tunelo per tenant).
I only read code. I ran no test suites, vitest, playwright, mongod or `tsc` on the repo. I read the code from
`git archive a2bfca0` in a scratchpad, because another session may edit the working tree. I ran three small Node
probes, all in the scratchpad: (a) a client reset during an async `upgrade` handler, (b) the ALS store in the
`message` and `close` handlers of `ws`, (c) whether `rootDir` breaks a TS workspace package reached through a
`node_modules` symlink.

## Scope
- Files: 35 (412291d) + 56 (a2bfca0) + 16 (d935942); about 1,450 lines added in a2bfca0.
- Focus: package-extraction regressions, cross-tenant leaks, tenant context lost in callbacks, auth per tenant,
  CLI token routing, nginx, repo rules.

## Overall assessment
The extraction preserves Localman's behaviour, and the tenant isolation of the data layer is sound: scoped models,
`tenantKey` maps, cache keys, per-tenant verifier and console. The main defect is new: an async gap in the
WebSocket upgrade path. A client reset during that gap crashes the whole Tunelo process (proved). The other
findings are smaller:
- A response-stream injection that existed before and now crosses tenants.
- Onboarding text that sends tenant users to the primary tenant.
- A CLI login order that throws away a working session.
- An ops script that writes untagged keys.
- Access-log redaction missing in the new nginx block.

## Critical
None.

## High

### H1. WebSocket upgrade: a client reset during the tenant lookup crashes Tunelo
`apps/tunelo-server/src/ws-handler.ts:89-100`
```ts
server.on("upgrade", (req, socket, head) => {
    void tenantDirectory().byHost(req.headers.host ?? "")
        .catch(() => undefined)
        .then((tenant) => { ... runInTenant(tenant, () => upgradeInTenant(req, socket, head)); });
});
```
- Node's HTTP server removes its `error` listener from the socket before it emits `upgrade`. Before this commit,
  `wss.handleUpgrade` ran synchronously and `ws` attached its own `socketOnError` straight away. Now there is an
  async gap with no listener on the socket.
- For a host outside `TUNNEL_DOMAINS`, `byHost` makes a real HTTP call to the IdP in three cases: on a cache miss,
  on every stale refresh (60 s per domain), and for every made-up `tunnel.<x>` host. While the IdP restarts, that
  call can take up to the 3 s timeout.
- A `RST` from the peer during that gap emits `error` on a socket with no listener. That is an uncaught exception,
  and the process exits. All tenants go down, the primary included, and all control channels with them.
  `server.ts` installs only `unhandledRejection`.
- Proved on Node v24.18.0 (scratchpad `probe/upgrade-reset.mjs`): `upgrade; error listeners: 0`, then
  `Error: read ECONNRESET ... Unhandled 'error' event`, exit 1.
- How exposed it is depends on the network. `server.listen(port)` binds every interface (`server.ts:117`), so if
  `:3001` is reachable from outside, one unauthenticated request plus a reset is a reliable kill. If it is reachable
  only through nginx, nginx must reset the upstream connection. That is rarer, but it happens, for example when
  nginx has unread upstream data.
- Fix: attach a handler before the await and check the socket afterwards:
  ```ts
  const onEarlyError = (): void => socket.destroy();
  socket.on("error", onEarlyError);
  ...then((tenant) => {
      socket.off("error", onEarlyError);
      if (socket.destroyed) return;
      ...
  });
  ```
  (`ws` adds its own listener inside `handleUpgrade`, and `rejectUpgrade` destroys the socket.)
- Add a test that resets the socket during a slow `byHost`. The current tests use `singleTenantDirectory`, so they
  never hit the gap.

## Medium

### M1. Response-stream frames are routed by request id alone; any authenticated client can inject into another tenant's response (existed before, now crosses tenants)
- `ws-handler.ts` (`case "stream-*"` → `tunnelManager.handleStreamFrame(msg)`, no connection id), then
  `stream/stream-registry.ts:48-76` (`push` and `pushLegacyResponse` look up `streams.get(frame.id)` and ignore
  `entry.connectionId`).
- The request id is `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  (`packages/tunelo-shared/src/constants.ts:65`). That is a known timestamp plus about 31 bits from
  `Math.random`. Every client sees the ids of its own requests, which is enough material to predict V8's
  xorshift128+ output.
- Scenario: a free account on any tenant domain predicts or sprays ids. It sends `stream-start` with chosen
  headers (`Set-Cookie`, HTML) and `stream-data` for a visitor request to another tenant's tunnel. The victim's
  browser gets attacker content on the victim's tunnel origin.
- Before this change the exposure was user to user on one domain. Now it spans every tenant on the process.
- Fix:
  - pass `state.id` into `handleStreamFrame` and `handleResponseByConnectionId`, and drop frames whose
    `entry.connectionId !== connectionId`;
  - generate request ids with `randomUUID()`.

### M2. A tenant's console (and Localman for tenants) tells users to run `tunelo login`, which signs them in to the primary tenant
- `apps/tunelo-server/src/web/getting-started.ts:16-29` hard-codes `tunelo login` and `tunelo http 3000`.
  `apps/web/src/features/api-client/tunelo/tunelo-commands.ts:15` does the same (`TUNELO_LOGIN`).
- Scenario: on `https://tunnel.acme.example` a user copies the steps. The CLI resolves the default server
  `tunnel.hoandat.com` and signs in at `auth.hoandat.com`. The tunnel opens on `*.tunnel.hoandat.com` under a
  hoandat account. Nothing appears in acme's console. Localman for acme refuses the URL, because
  `tunnelDomains` is `tunnel.acme.example`.
- Fix: for a non-primary tenant render `tunelo login --server https://<tenant.tunnelDomain>`. Localman should
  derive it from the tenant's tunnel domain, which it already sends as `tunnelDomains[0]`.

### M3. `tunelo login --server` revokes the working session and switches the default server before the new sign-in succeeds
`packages/tunelo-cli/src/cli-login-command.ts:125-144`
- Order: `revokeSession(existing)`, then `updateConfig(server)`, then `deviceLogin(serverUrl)`. `deviceLogin`
  calls `fail()` (`process.exit(1)`) when discovery, device authorization or polling fails.
- Scenario: a typo (`--server tunnel.hoandat.co`), an unreachable `auth.<d>`, or a user who closes the browser.
  The hoandat grant is already revoked and `config.server` already points at the bad host. Every later
  `tunelo http` fails until the user runs `tunelo login --server https://tunnel.hoandat.com` and goes through the
  device flow again.
- Fix: run the device flow first. On success, save the new session, then revoke the old grant (best effort), then
  save `server`.

### M4. `scripts/tunelo/create-access-token.mjs` writes `ApiKey` documents without a `tenantId`
- The script has its own schema with no `tenantId` and `keyHash: { unique: true }`. The scope plugin filters
  every lookup by `tenantId`.
- Scenario: an operator creates a token on the server. Tunelo answers "Invalid or expired token" until its next
  restart, when `tagUntaggedDocuments` tags the document.
- Also, with `autoIndex`, the script's model recreates the global unique `keyHash_1` index that
  `dropReplacedIndexes` removed. After that every Tunelo start drops it again, which is index churn.
- Fix: set `tenantId: process.env.TENANT_ID ?? "primary"` (or a `--tenant` flag), and set `autoIndex: false` on
  the script's connection (or remove the index declarations).

### M5. `infra/tunelo/nginx-tenants.conf` logs one-time secrets and has no IPv6 listener
- `access_log /var/log/nginx/tunelo-tenants.access.log;` uses the default `combined` format, so the full
  `$request_uri` lands in the log:
  - `/auth/callback?code=…&state=…` (the `tunelo-web` code of every tenant console sign-in);
  - `/login?req=…`;
  - device and link query strings.
- The IdP ships `log_format hoandat_tenants` with `$tenant_logged_uri` in `00-tenants-http.conf` precisely to
  redact `/auth/callback?` and `/device?` for "every app's tenant server blocks". The `tenant-auth.conf` and
  `localman-tenants.conf` blocks follow that convention; this block does not.
- Fix: `access_log /var/log/nginx/tunelo-tenants.access.log hoandat_tenants;` and extend the IdP map with
  `/login`.
- `listen [::]:443 ssl;` is missing. The IdP's `tenant-auth.conf`, `tenants-acme.conf` and the Localman tenant
  blocks all listen on IPv6, so a tenant with an AAAA record gets HTTPS on `auth.`/`localman.` but not on
  `tunnel.`.

## Low

### L1. A control channel that closes drops the usage of its in-flight responses and logs an error for each one
- `ws-handler.ts:287-295` → `tunnelManager.unregisterByConnectionId` → `StreamRegistry.cleanupByConnection` →
  `sink.onError` → the `onComplete` of `response-sink` → `usageTracker.record`.
- The `close` handler of `ws` runs with no ALS store. Probe `probe/ws-close-als.mjs` printed:
  bound `message` → `tenantA`, unbound `message` → `undefined`, `close` → `undefined`.
- Result: `findCurrentTenant()` is `undefined`, the bytes are dropped, and `"Usage outside a tenant dropped"` is
  logged at error level, once per open stream on every client disconnect.
- Nothing throws, because no code on this path calls `currentTenantId()` or `tenantKey()`. I checked
  `unregisterKey`, `cleanupTcpState`, `wsAppRelay.cleanupByConnection` and the grace timer.
- Fix: register the `close` handler through `AsyncResource.bind`, as `message` already is, or capture the tenant
  in `createResponseSink`'s closure.
- The vitest setup file sets a default tenant, so tests cannot catch this kind of path. This is the same trap as
  Localman's earlier `/healthz` bug.

### L2. Tenant apexes and unknown hosts report the process-wide tunnel count
`request-relay.ts:58-61` and `server.ts:71-73` return `tunnelManager.getStats()`, which counts every tenant's
tunnels, on every tenant's `tunnel.<d>/health`. It is a small cross-tenant metric leak. For non-primary tenants,
answer with the tenant's own count or just `{status:"ok"}`.

### L3. The WebSocket path reports an IdP failure as 421, the HTTP path as 503
`ws-handler.ts:91-96` (`.catch(() => undefined)` → 421 "Unknown host") versus
`tenant-scope-middleware.ts:16-22` (503). The CLI still retries. Proxies and operators see a misleading status
during an IdP restart.

### L4. `login --server X` while already signed in for X does not make X the default
`cli-login-command.ts:133-138` returns before `updateConfig(server)`. The help text says the server "becomes the
default server".

### L5. A custom server URL (not `tunnel.*`) now re-signs on every `tunelo login`
For a saved server such as `https://tunelo.corp.example`, `sameServer` is always false. Plain `tunelo login`
therefore revokes and re-runs the device flow, where it used to print "Already signed in". This mainly affects
self-hosted and dev users. Loopback is unaffected.

### L6. Global pools are shared by every tenant, with no per-tenant cap
`DEFAULTS.TCP_MAX_TUNNELS`, the TCP port range, the Redis cache and the WS app cap are process-wide. Accounts in
any claimed domain can be created through Google or GitHub, so a few accounts on one tenant can exhaust the TCP
pool for every tenant, the primary included. The IdP just added a per-account tenant cap; Tunelo has no per-tenant
counterpart.

### L7. nginx regex order hands the tunnel subdomains `auth` and `localman` of tenant domains to other apps
`auth.tunnel.<d>` matches the IdP's `~^auth\.` block. `localman.tunnel.<d>` matches Localman's `~^localman\.`
block. Both come first alphabetically in `conf.d`. Those tunnels are unreachable on tenant domains. Either reserve
the two names in the subdomain validation or document it.

### L8. Repo rules
- `ws-handler.ts` grew from 264 to 301 lines and `tunnel-manager.ts` from 362 to 373. Both were already over 200;
  the new upgrade and tenant code in `ws-handler.ts` could move to its own module.
- No `any`, no non-null `!`, ESM `.js` imports everywhere, named exports, kebab-case new files, every new file
  under 200 lines. No `console.log` in server code; the CLI legitimately uses `console`.

### L9. The `tsc` build script of `@tunelo/server` is unusable after this change
`apps/tunelo-server/package.json` keeps `"build": "tsc"` and `"start": "node dist/server.js"`. `dist` would import
`@localman/tenancy` as `.ts` source. That source has parameter properties (`TenantAnswerCache`), which Node's type
stripping refuses. Production uses `scripts/tunelo/build-server.ts`, which bundles the package, so this only bites
someone who runs the package scripts. Point `build` and `start` at the bundle, or remove them.

## Edge cases found by scouting
- Context loss: the only ALS-less paths that reach tenant code are `ws` `close` (usage, L1) and the upgrade gap
  (H1, a crash rather than context loss).
- Every other entry point is bound or runs in request scope:
  - `message` → `AsyncResource.bind`;
  - `res` `close` → bound;
  - the `end` handler of the request body → bound;
  - auth, ping and rate-limit timers → created inside `runInTenant`;
  - stream idle timers → created during `openStream` or `push`, both in scope;
  - TCP relay and ws-app-relay → no tenant calls;
  - grace timer → no tenant calls, and `sendRequest` has no production caller.
- `tunnel.tunnel.<d>` is read as the apex of the tenant `tunnel.<d>`. If the IdP answers the tenant `<d>` instead,
  `settle()` refuses it (421). The subdomain `tunnel` of `<d>` is therefore unreachable, which is consistent and
  harmless.
- Old Redis cache keys (`tunelo:cache:<sub>:…`) cannot collide with the new ones (`tunelo:cache:<tenant>:<sub>:…`);
  the segment counts differ. They age out by TTL.

## Verified fine
1. **Mongoose instance identity (412291d).**
   - `pnpm-lock.yaml` resolves one `mongoose@9.11.0` for `apps/api`, `apps/tunelo-server` and `packages/tenancy`
     (as a devDependency and peer).
   - `build-api.ts` bundles `@localman/*` and keeps every manifest dependency external, mongoose, zod, jose and
     openid-client included.
   - Tunelo's `build-server.ts` also bundles `@localman/*` and keeps `mongoose`, `zod`, `jose` and
     `openid-client` external, so they load from the VPS `node_modules`.
   - `runtime-manifest.mjs` drops `@localman/*`.
   - So `instanceof mongoose.Query`, `mongoose.modelNames()` in `scopedCollections` and `Symbol.for` marking all
     see one instance.
2. **Behaviour preserved (412291d).** I diffed the moved files against their old versions:
   - `loopback-fetch`, `tenant-errors`, `tenant-indexes` and `tenant-writes` are byte-identical;
   - the answer cache, context, scope plugin and migration differ only by generics and parameterisation;
   - the plugin's hooks are the same set in the same order;
   - the extended summary schema now also requires `resources.tunnel`, which the IdP has always returned
     (`resourcesFor` since c2caa4d);
   - the role `tunelo` is accepted by the IdP's `requireRole`;
   - the derived `tunelo-web` secret matches the IdP's `derivedClientSecret`.
3. **TypeScript resolution.** A workspace `.ts` package reached through a `node_modules` symlink counts as an
   external library, so `rootDir: "src"` of tunelo-server raises no TS6059 (probe with TS 5.9.3).
4. **Cross-tenant isolation.**
   - `tunnels`, `orphanedRequests` and `graceTimers` are keyed by `tenantKey`.
   - Counts, lists and `disconnectByKeyHash` filter on `tenantId`.
   - TCP allocations record `tenantId`; listings and `atTunnelLimit` filter on it.
   - Cache keys and purges carry the tenant.
   - Usage is buffered with its tenant and flushed with `runInTenant` per group.
   - Every Mongo model is scoped: `ApiKey`, `LinkRequest`, `LoginRequest`, `UsageLog`, `WebSession`. No raw
     `.collection` access and no `aggregate` or `estimatedDocumentCount`.
   - A server token of tenant A is not found on B.
5. **Auth.**
   - The primary keeps `AUTH_ISSUER`/`AUTH_AUDIENCE` and the public JWKS.
   - Other tenants verify with `iss = tenant.issuer`, `aud = https://tunnel.<d>`, ES256, `typ at+jwt`, and keys
     from `/internal/tenants/:id/jwks`. A token of A is refused on B and on the primary.
   - Back-channel logout verifies against the tenant's issuer and transport JWKS, and `deleteBySid` is scoped.
   - Each console has its own `PendingSignIns`; CSRF is bound to the session id; cookies are host-only
     (`__Host-`).
   - The OIDC client of a tenant console uses the internal discovery (issuer pinned) and loopback fetch (origin
     pinned).
6. **CLI.**
   - `acceptsAccountToken` sends the token only to a `tunnel.<d>` whose derived issuer equals the session issuer,
     over TLS, or to loopback.
   - A legacy session (`https://auth.hoandat.com`) with server `wss://tunnel.hoandat.com` is still accepted, and
     refresh uses `resourceOfIssuer`, which gives `https://tunnel.hoandat.com`.
   - The retired host `tunnel.inetdev.io.vn` no longer gets account tokens, and saved configs migrate.
   - Every path that sends the token goes through `resolveCredential`: tunnel setup, MCP, whoami.
7. **nginx.**
   - Exact and wildcard names for `tunnel.hoandat.com` win over the regex.
   - The certificate is chosen by SNI through `$tenant_cert`, which also covers the wildcard for `*.tunnel.<d>`.
   - `$host != $ssl_server_name` → 421.
   - Port 80 is covered by the IdP's `tenants-acme.conf`.
8. **Migration.** `migrateToTenants` tags documents with `tenantId: null`, awaits `init()` of every model, and
   drops the replaced indexes only when the IdP settings are on, so a rollback before that needs no index build.

## Recommended actions (in order)
1. H1: add an error listener and a `destroyed` check around the async upgrade lookup, with a reset test.
2. M1: route stream and response frames by connection id; use UUID request ids.
3. M3: in the CLI, sign in first, then revoke the old grant and save the server.
4. M2: per-tenant `tunelo login --server …` in the Tunelo console and in Localman.
5. M4: tag the tenant in `create-access-token.mjs` and stop it building indexes.
6. M5: use the redacting log format and add `[::]:443` to `nginx-tenants.conf` before installing it.
7. L1 to L9 as convenient. L1 is a one-line `AsyncResource.bind`.

## Metrics
- Type coverage: no `any` or non-null `!` added (grep of the added lines).
- Tests: not run, by instruction. New tests run under a default test tenant, so they cannot see H1 or L1.
- Lint: not run.

## Unresolved questions
- Is `:3001` firewalled on .65? That decides whether H1 can be triggered remotely and directly, or only through
  an nginx upstream reset.
- Should a tenant's users be allowed one CLI session per domain (several stored sessions)? The single-session
  model makes M3 and L5 sharper.

Status: DONE_WITH_CONCERNS
Summary: The extraction keeps Localman's behaviour and the data isolation is sound, but an unguarded async gap in
the WebSocket upgrade lets a client reset crash Tunelo (proved on Node 24). The remaining issues are a
cross-tenant stream-injection path, onboarding commands that send tenant users to the primary, a CLI login order
that destroys the working session on failure, an ops script that writes untagged keys, and missing log redaction
in the new nginx block.

## Đã sửa (13/10/2026)

Commit `40571ed`, `3005b13` trên `main` của `localman-next`.

- H1: upgrade giữ handler `error` trên socket tới khi tra tenant xong, socket đã huỷ thì bỏ qua; IdP lỗi trả 503 như đường HTTP (L3). Test `ws-upgrade-lookup.test.ts` reset client giữa lúc tra; bỏ guard thì vitest báo `Unhandled ECONNRESET`.
- M1: frame stream, response (kể cả response legacy) và `ws-data`/`ws-close` chỉ nhận từ đúng connection đã gửi request; bỏ nhánh cho connection khác trả lời request mồ côi (tunnel nối lại đã nhận chúng qua `register`); id request là `req_<randomUUID>`.
- M2: console Tunelo và Localman hiện `tunelo login --server https://tunnel.<d>` khi domain khác domain mặc định của CLI; thông báo lỗi của server dùng cùng lệnh.
- M3: `tunelo login` đăng nhập xong mới thu hồi grant cũ, lưu phiên và đổi server mặc định; đã đăng nhập đúng IdP thì `--server` vẫn đặt server mặc định (L5a). So "đã đăng nhập" theo issuer mà server sẽ dùng, nên server tự đặt (không phải `tunnel.*`) không bắt đăng nhập lại (L5b). Có test lệnh `login` (trước đây chưa có).
- M4: `create-access-token.mjs` gắn `tenantId` (`TENANT_ID`, mặc định `primary`), `autoIndex: false`.
- M5: `nginx-tenants.conf` log định dạng `tunelo_tenants` (bỏ query string), thêm `listen [::]:443 ssl`.
- L1: handler `close` của kênh điều khiển chạy trong tenant (`AsyncResource.bind`). L2: `/health` trên apex của tenant chỉ đếm tunnel của tenant đó (`/health` loopback vẫn đếm tất cả).
- `ws-handler.ts` 301 → 188 dòng (kênh điều khiển sang `ws-control-channel.ts`).

Chưa sửa: L6 (giới hạn cổng TCP chung mọi tenant, chờ có tenant thật để đặt quota), L7 (block nginx của app khác bắt subdomain `auth`/`localman` dưới `tunnel.<d>`: chỉ là tên tunnel bị chiếm), L9 (script `tsc` build/start của `@tunelo/server`, prod dùng bundle), `tunnel-manager.ts` vẫn quá 200 dòng (có từ trước).
