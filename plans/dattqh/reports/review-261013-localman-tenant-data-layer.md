# Review: localman-next d3a080f — tenant-scoped data layer

## Code Review Summary

### Scope
- Commit: `d3a080f feat(tenants): scope every Localman document to a tenant` (90 files, +1518/-174)
- Focus: `apps/api/src/tenancy/*`, the 41 model files, `mock-runtime/{usage-meter,project-activity,request-log-*}`, `mock-callbacks/{outbound-claims,retry-queue}`, `scripts/create-tenant-indexes.ts`, `infra/localman/activate-release.sh`, ADR 0003
- Method: diff read at the commit (`git show d3a080f:…` / `git archive`). Another session was editing the working tree during the review, so working-tree files were not trusted as the commit's code. I ran throwaway probes (scratchpad only, no repo edits, no vitest run) against mongoose 9.11.0, express 5.2.1, Node 24.18 and mongodb-memory-server (mongod 8.2.6). They imported the commit's unchanged `tenant-context.ts` and `tenant-scope-plugin.ts`.
- Scout findings: an aborted request's `close` handler runs outside the request's async context, and two schemas use explicitly named indexes. Queries run under `acrossTenants` can no longer use any index after the old indexes are dropped, and the rate-limit `_id` is shared by all tenants. The test default tenant hides context loss.

### Overall Assessment
The plugin works for the operations it hooks, as long as the query runs inside the scope. My probes confirmed tenant filtering and stamping for `exists`, `findById*`, `cursor()`, `populate`, `countDocuments`, `distinct`, `aggregate`, `bulkWrite` (insert/update/upsert), `replaceOne` upsert, `doc.deleteOne()`, `bulkSave`, and the cross-tenant `save()` guard. The request middleware, flushes and periodic jobs keep the tenant correctly. Three defects need fixing before this ships:
1. The next deploy fails, because two indexes are named explicitly.
2. Request-log trimming does a full collection scan once the old indexes are dropped.
3. Rate-limit windows break as soon as a second tenant exists.

---

## Critical Issues

None that leak data in the single-tenant setup this commit deploys.

## High Priority

### H1. The next deploy fails: explicitly named indexes conflict with their tenant versions
- `apps/api/src/modules/collections/collection-revision-model.ts:56-63` declares `{ name: "partial_by_seq" }` and `{ name: "trimmed_by_seq" }`.
- `apps/api/src/tenancy/tenant-scope-plugin.ts:55-58` re-adds each index as `{ tenantId: 1, ...fields }` **with the same options, so with the same name**.
- Production already has `partial_by_seq` and `trimmed_by_seq` with the old keys. They were added in e7f1960 (2026-10-11), and there were several deploys on 2026-10-12.
- MongoDB refuses `createIndex` when an index with the same name but different keys exists.
  - Reproduced: `MongoServerError: An existing index has the same name as the requested index`.
  - So `Model.init()` rejects, `create-tenant-indexes.mjs` exits 1, and `activate-release.sh` dies with "current release unchanged".
  - If the release were started without that step (manual `switch-release.sh`), `migrateToTenants` → `initModels` would reject and pm2 would crash-loop the API.
- The migration test (`tenant-migration.test.ts`) only seeds `projects` with auto-named indexes, so CI does not see this.
- **Fix:** in `prefixIndexes`, rename named non-TTL indexes, e.g. `options.name ? { ...options, name: \`tenantId_${options.name}\` } : options`, or remove `name` so Mongo generates one. `dropReplacedIndexes` then drops the old named index, because it matches on keys, not names. Add a migration test that pre-creates `partial_by_seq` with the old keys on `collection_revisions`.

### H2. Request-log trimming does a full collection scan after the old indexes are dropped; the outbound queue scans every second
- The trimmer runs under `acrossTenants`, so its query has no `tenantId` (`request-log-service.ts:176`; query at `request-log-trim.ts:19-28`): `{ projectId }`, sorted by `_id: -1`, `skip(20000)`.
- After `dropReplacedIndexes` removes `{projectId:1,_id:-1}`, the only index that covers it is `{tenantId:1,projectId:1,_id:-1}`. That index cannot serve this sort while `tenantId` is unbounded, so the planner picks `_id_`.
- Measured (`explain("executionStats")`, 100k lines):

  | Query | keys examined | docs examined |
  |---|---|---|
  | Project with 100 lines (under the cap), across tenants | 100,000 | 100,000 (the whole collection) |
  | Same query with `tenantId` | 100 | 0 (covered) |

  This runs for every active project at most every 30 s (`TRIM_EVERY_MS`), on the largest collection. Most projects are under the cap, so most trims read the entire collection.
- `outbound-claims.ts:17-27` (`takeExpiredJob`) and `:33-55` (`claimDueJob`) also run across tenants. Against the tenant-prefixed `{tenantId,state,nextAt}` and `{tenantId,deadlineAt}` they become `COLLSCAN` (plus an in-memory `SORT` for the claim), every poll (1 s). `outbound_jobs` is capped per owner, so this is cheaper, but it is still a full scan.
- **Fix (trimmer):** have the trimmer keep the tenant. `note(tenant, projectId)` is called inside `runInTenant` in `flushAll`, so store `tenantId` with the project and run `trimProjectLog` under `runInTenantData(tenantId, …)`. This also removes `request-log-service.ts` from the `acrossTenants` allow-list.
- **Fix (queue):** let a schema index opt out of prefixing for queries that must run across tenants. For example, a plugin option listing the index keys to keep unprefixed: `{ state:1, nextAt:1 }` and `{ deadlineAt:1 }` on `outbound_jobs`. Because `dropReplacedIndexes` only drops an index when its prefixed twin exists, the unprefixed ones would survive.

### H3. Rate-limit windows: a document `_id` cannot be unique per tenant, so a second tenant gets 500s (latent)
- `apps/api/src/lib/rate-limit-windows.ts:15,78-95`: `_id = "${scope}:${hash(key)}:${start}"`, upserted with `findOneAndUpdate`.
- The plugin adds `tenantId` to the filter, but `_id` is unique across the whole collection.
- Reproduced: tenant A creates `login:abc:0`. Tenant B then does the same upsert → no match on `{_id, tenantId:B}` → insert → `E11000`. The single retry fails the same way, and the error propagates.
- The keys are shared across tenants: IP buckets (`invite-rate-limits.ts:22`, `feedback-guards.ts:36`), `owner-alert-throttle.ts`, and subject keys.
- Result: from the second tenant on, one client hitting two tenants in the same window gets errors for that window on every rate-limited operation of the second tenant.
- **Fix:** put the tenant in the key (`${currentTenantId()}:${scope}:…`). Old documents expire within one window, so no migration is needed. Also check the other string-`_id` schemas. `session`, `login_transaction`, `logout_token` (`issuer jti`), `audit_event` (jti) and `workspace_lock` (owner sub / workspace id) are random or IdP-unique, so they are fine.

## Medium Priority

### M1. Aborted mock requests: the log line is dropped and an error is logged each time
- `request-log-capture.ts:143-144` registers `res.once("close", record)`.
- Probe (Node 24): when the client aborts, `close` runs with **no ALS store** (`["/abort","close",null]`). The `finish` and normal `close` events keep the store.
- So `RequestLogService.record` → `findCurrentTenant()` returns `undefined` (`request-log-service.ts:102-106`). The line, which used to be logged, is dropped, and `logger.error("Request log line outside a tenant dropped")` fires on every client abort. Those are exactly the lines that matter for chaos/latency debugging.
- Tests cannot see this, because of M3.
- The **uncommitted** working tree already wraps `record` with `AsyncResource.bind`. That is the right fix, but it is not in this commit.

### M2. `runInTenant`/`acrossTenants` with a lazy Query run in the *outer* tenant, not "outside any tenant"
- `tenant-context.ts:35-55` returns `fn()` straight from `storage.run`. A mongoose `Query`/`Aggregate` is a thenable that runs when awaited, which happens after `run` has returned, so it runs in the caller's context.
- Probe: inside tenant B, `await runInTenant(A, () => M.findOne({ name: "a" }))` returned `null` (B's view); without an outer scope it threw `MissingTenantError`.
- ADR 0003 says this only "loses the context". Inside a request it actually **reads or writes as the request's tenant**, which becomes a cross-tenant bug once a request handler runs work for another tenant.
- All current call sites pass async functions or `.exec()` (checked every call site).
- **Fix (cheap):** type the callback as `() => Promise<T>` and run `storage.run(scope, async () => await fn())`, or throw when `fn()` returns a thenable that is not a native `Promise`.

### M3. The test default tenant hides every context-loss bug
- `findCurrentTenant`/`currentTenantId` fall back to `testDefault` when there is **no store** (`tenant-context.ts:58-61,87-92`). `vitest.config.ts` installs it for every file (`tenant-setup.ts`).
- Any path that loses ALS (M1, timer callbacks, emitter callbacks) passes the whole suite while it throws or drops data in production. Only `tenant-scope-runtime.test.ts` turns the default off.
- **Fix:** run the HTTP harnesses (`dashboard-test-app`, the mock harness) with the default cleared, since they go through the middleware anyway. Keep the default only for unit tests that call models directly.

### M4. Rollback after this release is slow: old indexes are dropped before the release is confirmed healthy
- `migrateToTenants` (`tenant-migration.ts:77-81`) drops the replaced indexes at startup, before `switch-release.sh` has seen `/healthz` or nginx.
- If the new release then fails a check, or is rolled back by hand later, the previous release's `initModels()` must rebuild every unprefixed index before it listens: about 40 indexes, including four on `request_logs`.
- That can easily take longer than the 30 s health window. The rollback then reports "ROLLBACK TO … FAILED" while the build continues.
- **Fix:** expand/contract. Ship this release without `dropReplacedIndexes`, then drop the old indexes in a later release or with an ops command once this one is confirmed. Otherwise, at least document in the deployment guide that a rollback across this release rebuilds indexes.

### M5. In-process caches keyed without the tenant (latent until a second tenant)
- At the commit:
  - `resolve-project.ts:128`: keyed by secret, and `secret` is now only unique per tenant.
  - `mock-mcp-tools-cache.ts:60`
  - `localman-mcp-limits.ts:93` (`knownSubjects`)
  - `mock-mcp-guards.ts:37`
- Harmless with one tenant. The ADR calls this layer "done for data", but these caches hold documents. The uncommitted working tree is adding `tenantKey(...)` for some of them. Make sure they all land before `TenantDirectory` returns more than one tenant.

## Low Priority

- **L1. Plugin gaps that are open by design** (`tenant-scope-plugin.ts:98-131`):
  - `insertMany(..., { lean: true })` keeps a caller-supplied foreign `tenantId`. Probe: inserted into A from B's scope. `stampMany` only fills a missing value; it should overwrite it or throw `CrossTenantWriteError`.
  - `updateOne(..., { $set: { tenantId } })` moves a document to another tenant (probe confirmed). A query hook could refuse updates that touch `tenantId`.
  - `estimatedDocumentCount` (returned 2 across tenants in the probe) and `Model.watch` are unfiltered. Neither is used today.
- **L2. The source-scan regex in `tenant-models.test.ts:41-44` is easy to miss:**
  - It does not match `.collection.(aggregate|countDocuments|distinct|findOne*)`, `connection.db.collection(`, a local `collection.updateMany(` (as in `tenant-migration.ts` itself), or `$lookup`/`$unionWith`/`$graphLookup` stages. The `$match` that is prepended only scopes the outer collection.
  - Add those patterns to the regex.
- **L3. The tagging scan is not free on every boot for some collections.** `tagUntaggedDocuments` (`tenant-migration.ts:26-42`) runs `{tenantId:null}` as a `COLLSCAN` on collections that have no tenant-prefixed index: `resource_tree_locks`, `workspace_locks`, `login_transactions`, `logout_tokens`, `rate_limit_windows`. These are small collections, but ADR 0003 claims the query "follows the index", which is wrong for them.
- **L4. One failing tenant group drops later groups' lines.** In `request-log-service.ts:159-171`, a failure in one tenant group `return`s. The remaining tenants' lines in that batch are dropped and the trim is skipped, and the error reports `batch.length`, which overstates the loss. Catch per group, as `ProjectActivity.flush` does.
- **L5. Jobs of an unknown tenant are lost or stuck.**
  - `takeExpiredJob` deletes the job before its tenant is resolved (`retry-queue.ts:99-101,127-134`), so a job of an unknown tenant is lost with only a warning.
  - `launch` calls `storedTenantId(job)` after the claim. An untagged job throws there and stays `running` until its lock expires, then repeats.
  - Neither can happen after `migrateToTenants`, but resolve the tenant before taking the job.
- **L6. Dependence on mongoose internals.** `prefixIndexes` writes the private `SchemaType._index` (`tenant-scope-plugin.ts:48-49`), which may change on a mongoose upgrade. The model test would catch a regression.
- **L7. Inaccurate comment.** The `scopeBulkOperations` comment says "a copy, callers may reuse theirs", but it replaces `filter` on the caller's operation object and stamps `document` in place.
- **L8. Case-insensitive tenant match under collation.** Queries that pass the case-insensitive collation (`users.username/email`) also compare `tenantId` case-insensitively. Two random `ten_` ids colliding that way is about 1e-25 likely, so this is informational only.

## Edge Cases Found by Scout
- `res` `close` on an aborted request has no ALS store (M1). `finish` and a normal `close` keep it. The body parser keeps it too (probe: delayed chunked JSON and text bodies both saw the store).
- SSE heartbeat `setInterval` (`log-stream-routes.ts:112`) and `chaos-delay` timers are created inside the request, so they keep the tenant. `inbox-route.ts:89` (`finish` → enqueue) keeps it.
- Notification background sends (`inBackground`) are promise-based, so they keep the tenant. There is no Telegram polling loop.
- The shared `feedback` collection (two models): `scopedCollections` deduplicates by name, and `dropReplacedIndexes` reads the indexes from the database, so neither model's index is dropped wrongly.
- No child schema has indexes. The shared `storedVariableSchema` has none, so `strip()` changing child schemas has no effect today.
- TTL indexes, including the partial TTLs on collaborators, workspace members and access requests, stay single-field and keep their name, so there is no conflict.
- pm2 runs `fork`, `instances: 1`, so `reload` is a restart. The old and new releases never write at the same time, and startup tagging catches whatever the old release wrote after the pre-deploy step. Unique invariants hold while tagging, because the old global unique indexes still exist.

## Verified fine
- With the query run inside the scope, the plugin filters or stamps all of these (probe): `find/findOne/exists/findById/findByIdAndUpdate`, `cursor()`, `populate`, `countDocuments`, `distinct`, `aggregate` (no first-position-only stage like `$geoNear`/`$search` is used, and there is no `$lookup` anywhere), `updateOne` upsert, `replaceOne` upsert, `bulkWrite` insertOne/updateOne, `doc.deleteOne()` (deletedCount 0 cross-tenant), `bulkSave` (refused cross-tenant), and non-lean `insertMany`/`create` with a foreign `tenantId` (refused). Subdocument push and save work. A call outside any scope throws `MissingTenantError`.
- Raw driver writes: only `crud-handlers.ts:87,127`, and both add `tenantId`. The transactions in `project-lock.ts`/`workspace-lock.ts` keep ALS (promise chains).
- `UsageMeter`, `ProjectActivity` and `RequestLogService` capture the tenant at count or record time and flush per tenant. The usage-meter key includes the tenant, and the `loading` map is keyed the same way.
- The outbound queue `$nor` of `{tenantId, owner}` pairs is correct. Each job runs (`runOutboundJob`, expire, put back on abort) under `runInTenant` of its stored tenant.
- `forEachTenant` uses `distinct` across tenants (index `{tenantId,sub}`) and isolates failures per tenant. Every callback passed to `runInTenant`/`runInTenantData`/`acrossTenants`/`forEachTenant` is an async function or uses `.exec()`.
- Startup order in `main.ts`: migrate → `configurePrimaryTenant` → apps → queues/jobs. Nothing touches a model before the directory exists.
- `create-tenant-indexes.mjs` is idempotent; activate-release aborts when it fails. The tenant id regex matches the IdP format (`ten_` + 12 random bytes as base64url = 16 chars).
- Repo code rules: every touched `.ts` file is ≤200 lines (`usage-meter.ts` 199, `request-log-service.ts` 198), with no `any`, no `!`, no `console.log`, no lint suppressions, `.js` ESM imports and named exports.

## Recommended Actions
1. H1: rename or remove named indexes in `prefixIndexes`, and add a migration test with a pre-existing `partial_by_seq`. **Required before any deploy.**
2. H2: run the trim per tenant; keep unprefixed indexes for the cross-tenant claim and expire queries.
3. H3: put the tenant id in the rate-limit `_id`.
4. M1: land the `AsyncResource.bind` fix that is in the working tree. M3: clear the test default for HTTP harnesses, so M1-type bugs fail CI.
5. M2: make `runInTenant`/`acrossTenants` await inside the scope, or refuse non-Promise thenables.
6. M4: defer dropping the old indexes to a later release, or document the slow rollback.
7. L1/L2: overwrite or refuse a foreign `tenantId` in `insertMany`; widen the source scan.

## Metrics
- Type coverage: strict TS; no `any`/`!` added (grep of the added lines).
- Test coverage: not measured; I did not run vitest (machine is shared). Probes were standalone scripts in the scratchpad.
- Linting issues: not run.

## Unresolved Questions
- Is a rollback across this release a supported path? That decides whether M4 needs a code change or only documentation.
- Should cross-tenant queue scans use indexes with no prefix (an opt-out in the plugin), or should the queue claim per tenant? The opt-out is simpler with only a few tenants.

Status: DONE_WITH_CONCERNS
Summary: The plugin and tenant scoping are correct inside a scope. However, the next deploy fails because named indexes conflict with their tenant versions (H1). Cross-tenant trimming and queue claims lose their indexes, so trimming scans the whole collection (H2). Rate-limit `_id`s collide once a second tenant exists (H3).
