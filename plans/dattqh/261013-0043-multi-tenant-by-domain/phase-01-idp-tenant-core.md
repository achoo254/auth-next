---
phase: 1
title: "IdP: lõi tenant, hoandat là tenant duy nhất"
status: done
priority: P1
effort: "L"
dependencies: []
---

# Phase 01: IdP — lõi tenant, hoandat là tenant duy nhất

## Goal

Mọi đường dữ liệu, mọi resource/audience và mọi chuỗi hiển thị của IdP đi qua một `Tenant`, với `hoandat.com` là tenant duy nhất dựng từ env, và production không đổi hành vi nào (cùng issuer, `kid`, client id, tên cookie, token, giao diện chữ "hoandat").

## Bối cảnh đã đo

- `ISSUER` dùng ở 16 chỗ trong `src/`: `app.ts` (security, `requireKnownHost`, privacy), `services.ts`, `server.ts`, `oidc/provider.ts` (Provider, `cookieConfig`), `oidc/clients.ts`, `oidc/client-seed.ts`, `accounts/upstream-client.ts`, `app-directory/apps-catalog.ts`, `app-directory/apps-page.ts`.
- Hằng số gắn một tenant ngoài `ISSUER` (RT 1): `RESOURCES`/`isResourceIndicator` (`src/oidc/resources.ts:10-14,68-75,96-101`), `EXCHANGE_TARGET` (`src/oidc/token-exchange-request.ts:9`), `allowed_resources` của DCR (`src/oidc/registration-policy.ts:106,112`), URL client tĩnh (`src/oidc/clients.ts:76-77,102,113,128`), `FIRST_PARTY_NAME_PATTERN` (`src/oidc/first-party-name.ts:2`), `apps-catalog.ts:94`.
- `AppServices` (`src/services.ts`) đã là gói theo một issuer.
- Collection của IdP: `accounts` (5 chỉ mục unique toàn cục: `username`, `email_unique_when_set`, `providers.google`, `providers.github`, `telegram.chatId` — `src/accounts/user-model.ts:156-185`), `one_time_tokens`, `audit_outbox`, `session_meta`, `grant_meta`, các `oidc_*` của adapter. Truy cập trực tiếp Grant/Session ở `src/account-portal/{grant-directory,revoke-access,session-directory,account-access-routes}.ts`, `src/oidc/{sliding-grants,client-seed}.ts`.
- Adapter ghi bằng `replaceOne({ _id }, …, { upsert: true })` và `consume`/`destroy` theo `_id` (`src/oidc/mongo-adapter.ts:85-136`); `conflictField` lấy khoá đầu của `keyPattern` (`src/accounts/account-conflicts.ts:15-17`).
- Cookie đều host-only `__Host-`/`__Secure-`, không có `Domain` (`src/oidc/cookies.ts`, `src/http/csrf.ts`): trình duyệt đã tách cookie theo host (RT 15).
- Harness conformance (`e2e/support/conformance-server.ts`) dùng issuer `https://<sub>.tunnel.hoandat.com`, không theo dạng `auth.<domain>` (RT 15).

## Files to Create / Modify

- Create `src/tenants/tenant.ts`: kiểu `Tenant` (`id`, `domain`, `displayName`, `issuer`, `status`), `appHostsFor(domain)`; `normalizeTenantDomain` dùng chung (RT 12: chỉ LDH/punycode, ≤ 253 ký tự, bỏ dấu chấm cuối và cổng, chữ thường, từ chối public suffix và danh sách domain cấm).
- Create `src/tenants/env-tenant.ts`: tenant cũ từ env; env mới **`TENANT_DOMAIN`** (tường minh, không suy từ `ISSUER`, RT 15) và `TENANT_DISPLAY_NAME` (mặc định `hoandat`); `id` cố định.
- Create `src/tenants/tenant-resources.ts` (RT 1): `resourcesFor(tenant)` (localman, localman MCP, tunnel suy từ `appHostsFor`), dùng cho `getResourceServerInfo`, `defaultResource`, `EXCHANGE_TARGET`, chính sách DCR, `buildStaticClients(tenantUrls)`; brand của tenant vào mẫu tên first-party. Tenant cũ ra đúng các URL hiện tại.
- Modify `src/config/env.ts`: thêm `TENANT_DOMAIN`, `TENANT_DISPLAY_NAME`; **không** ép dạng `ISSUER` (harness conformance phải chạy được).
- Modify `src/services.ts`, `src/oidc/provider.ts` (tách phần theo tenant ra tệp mới, giữ ≤ 200 dòng), `src/oidc/resources.ts`, `src/oidc/token-exchange-request.ts`, `src/oidc/registration-policy.ts`, `src/oidc/clients.ts`, `src/oidc/first-party-name.ts`, `src/app-directory/apps-catalog.ts`.
- Client id **giữ cố định** cho mọi tenant (`localman-web`, `tunelo-cli`, `tunelo-web`, `hoandat-account`); chỉ `client_name` lấy brand (RT 1).
- Modify `src/oidc/mongo-adapter.ts` (RT 2): ghi lọc **chỉ theo `_id`** và `$set: { tenantId }`; `find`/`findByUserCode`/`findByUid` lọc `tenantId`; `consume`/`destroy`/`revokeByGrantId` với tenant cũ khớp `tenantId: { $in: [id, null] }`; chỉ mục ghép `{ tenantId, grantId|userCode|uid }`. Client không bao giờ đi qua adapter (chỉ cấu hình `clients` của Provider).
- Modify repository: `src/accounts/{account-repository,account-links,account-tokens,one-time-tokens,user-model,account-conflicts}.ts`, `src/audit/audit-outbox.ts`, các tệp truy cập Grant/Session ở trên (gồm `account-access-routes.ts:102`, `client-seed.ts:80`), `src/services.ts` (`session_meta`, `grant_meta`). `reclaimEmail` lọc theo tenant (`src/accounts/account-links.ts:143-150`).
- Chỉ mục (RT 3): tạo chỉ mục ghép `{ tenantId, X }` cho **cả 5** khoá unique; `conflictField` bỏ qua `tenantId`.
- i18n `src/i18n/messages/{en,vi,zh-cn}/*.ts` và `src/ui/layout.ts`: "hoandat" thành biến `{brand}`.
- Create `scripts/create-tenant-indexes.ts` (RT 14): tạo chỉ mục ghép mới **trước** deploy (khởi động chỉ còn no-op), in thời gian build.
- Create `scripts/backfill-tenant-id.ts`: gắn `tenantId` tenant cũ cho bản ghi thiếu, idempotent, `--dry-run` chỉ in số đếm.
- Modify `scripts/build.ts` (thêm hai entry).
- Create `src/__tests__/tenant-isolation.test.ts`, mở rộng `src/__tests__/helpers/test-idp.ts` cho hai tenant cùng database.

## Tasks & Steps

1. `Tenant`, `normalizeTenantDomain`, tenant từ env; thay 16 chỗ `env.ISSUER` và các hằng số resource/client bằng hàm của tenant.
2. Adapter theo tenant như trên; test riêng "bản ghi chưa có `tenantId` đi qua upsert, consume, destroy, slide, session meta" (RT 2).
3. Repository tài khoản, token một lần, audit, session/grant meta theo tenant; test quét mã nguồn: không chỗ nào gọi `db.collection(...)` các collection này ngoài repository.
4. Chỉ mục ghép cho 5 khoá unique; giữ chỉ mục cũ tới phase 02 (vẫn đúng khi một tenant).
5. Branding `{brand}`; test snapshot: chuỗi hiển thị, discovery, `kid`, tên cookie và `Set-Cookie` (không có `Domain`, giữ tiền tố) của tenant cũ giống hệt trước (RT 15).
6. Script tạo chỉ mục và backfill + test (dry-run không ghi; chạy hai lần cùng kết quả).
7. Test cô lập hai tenant: access/refresh/ID token, authorization code, device code, phiên, grant, tài khoản (cùng Google `sub` đăng ký được ở hai tenant, RT 3), token một lần, audit, token exchange không ra `aud` của tenant kia (RT 1).
8. Docs: ADR 0006 (tenant, `tenantId`, đọc tương thích có thời hạn, thứ tự chỉ mục → deploy → backfill, chính sách chỉ sửa tiến sau khi có tenant thứ hai); `CLAUDE.md` thêm quy tắc repository có tenant.
9. Rollout prod (khi user yêu cầu): backup → `create-tenant-indexes` (đo thời gian) → deploy → backfill dry-run → backfill → 0 bản ghi thiếu → Localman/Tunelo đăng nhập, refresh, token exchange, Config OP 38/38, harness conformance chạy, restart trước/sau 15 phút.

## Verification

- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens` sạch; test cũ pass không sửa kỳ vọng.
- `tenant-isolation.test.ts` pass cho từng loại artifact; test bản ghi legacy pass.
- `pnpm conformance:idp` vẫn khởi động được.

## Risks

- Quên `tenantId` ở một truy vấn: test quét mã nguồn + test cô lập.
- Bản ghi tạo giữa deploy và backfill: đọc/ghi tương thích che khoảng này; backfill chạy lại được. Đọc tương thích bị gỡ ở cuối phase 02, trước khi tenant thứ hai tồn tại (RT 4).
