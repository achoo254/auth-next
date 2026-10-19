# Localman: bản đồ phạm vi multi-tenant (inventory chỉ đọc)

Phạm vi: `apps/api`, `apps/web`, `packages/*` (trừ tunelo), `infra/localman`. Đường dẫn gốc: `/Users/hoandat/inet-gitlab/localman-next/`. Mốc thời gian Asia/Saigon.

## 1. Collections (41 model `mongoose.model(...)`, trừ test)

Ký hiệu: **U** = unique, **TTL** = expireAfterSeconds, **G** = khóa toàn cục có thể va chạm giữa tenant, **T** = cần `tenantId` trong unique index.

| Model | Collection | File:dòng | Khóa tra cứu chính | Unique / TTL | Cờ |
|---|---|---|---|---|---|
| Project | `projects` | `modules/projects/project-model.ts:14,54,52` | `secret` (đi vào host `{secret}.localman…`), `owner`+`quotaSlot` | U `secret` (l.14), U `(owner,quotaSlot)` (l.54) | **G**, **T** |
| Resource | `resources` | `modules/resources/resource-model.ts:84-85,78` | `projectId`+`parentId`+`name`, `ownerSub`+`quotaSlot` | U (l.84, l.85) | **T** (`ownerSub` là khóa quota toàn cục) |
| Record | `records` | `modules/resources/record-model.ts:25,23` | `resourceId`+`id` | U | theo project |
| ResourceTreeLock | `resource_tree_locks` | `modules/projects/project-lock.ts:19` | project | — | theo project |
| User | `users` | `modules/users/user-model.ts:11,61,75-82` | `sub` | U `sub` (l.11); username/email không U, collation (l.75-76) | sub là IdP-global; cần `tenantId` cho profile/plan |
| Workspace | `workspaces` | `modules/workspaces/workspace-model.ts:24,27-29,31` | `ownerId` (personal) | U partial personal (l.27-29) | **T** |
| WorkspaceMember | `workspace_members` | `modules/workspaces/workspace-member-model.ts:31,35-48,52-56` | `(workspaceId,userId)`, `(workspaceId,email)`, **`inviteTokenHash` toàn cục** | U (l.35, 39, 43-48); TTL `expiresAt` (l.52-56) | **G** (inviteTokenHash), **T** |
| WorkspaceLock | `workspace_locks` | `modules/workspaces/workspace-lock.ts:18` | workspace | — | theo workspace |
| Collection | `collections` | `modules/collections/collection-model.ts:57,66-76` | `workspaceId`, `deletedAt`, `deletedBy` | không U | theo workspace |
| CollectionNode | `collection_nodes` | `modules/collections/collection-node-model.ts:40,46-48` | `collectionId`+`parentId`+`order` | không U | theo collection |
| CollectionRevision | `collection_revisions` | `modules/collections/collection-revision-model.ts:49,51-52,55-62` | `(collectionId,seq)` | U (l.51) | theo collection |
| CollectionFavorite | `collection_favorites` | `modules/collections/collection-favorite-model.ts:9,11-13` | `(userId,collectionId)` | U (l.11-13) | **T** (userId là sub toàn cục, cần tenant) |
| Environment | `environments` | `modules/environments/environment-model.ts:21,27` | `(workspaceId,name)` | không U | theo workspace |
| ActiveEnvironment | `active_environments` | `modules/environments/active-environment-model.ts:14,16-17` | `(userId,workspaceId)` | U (l.16) | **T** |
| GlobalVariables | `global_variables` | `modules/environments/global-variables-model.ts:15,21` | `workspaceId` | U (l.21) | theo workspace |
| LocalVariableValue | `local_variable_values` | `modules/environments/local-variable-value-model.ts:19,21-26` | `(userId,scope,key)` | U (l.21-23) | **T** |
| CallbackConfig | `mock_callbacks` | `modules/mock-callbacks/callback-model.ts:59,61-62` | `resourceId` | U (l.61) | theo resource |
| OutboundJob | `outbound_jobs` | `modules/mock-callbacks/outbound-job-model.ts:108,110-114` | `state`+`nextAt`, `projectId`, `owner` | **TTL `purgeAt`** (l.114) | cần tenantId trên job |
| Inbox (webhook) | `webhook_inboxes` | `modules/webhook-inbox/inbox-model.ts:59,61` | `(projectId,name)` | U (l.61) | theo project |
| McpToken | `mcp_tokens` | `modules/mcp/mcp-token-model.ts:21,27,76` | `projectId` (U), `tokenHash` | U `projectId` (l.21) | theo project |
| MagicLink | `magic_links` | `modules/collaborators/magic-link-model.ts:12-13,21` | **`tokenHash` toàn cục** (lookup l.41, l.68 của `invite-eligibility.ts`) | U `projectId`, U `tokenHash` | **G** |
| Collaborator | `collaborators` | `modules/collaborators/collaborator-model.ts:36,41-68` | `(projectId,inviteeUserId)`, `(projectId,inviteeEmail)`, **`inviteTokenHash` toàn cục** | U (l.41,48,55); **TTL** (l.64-67) | **G**, **T** |
| MemberRemoval | `member_removals` | `modules/collaborators/member-removal-model.ts:18,20` | `(projectId,userSub)` | U (l.20) | theo project |
| ElementRole | `element_roles` | `modules/access/element-role-model.ts:29,31-41` | `(userId,elementType)`, `(elementType,elementId)` | U partial userId/email (l.31-37) | **T** |
| AccessRequest | `access_requests` | `modules/access/access-request-model.ts:38,40-49` | `(elementType,elementId,requesterId)` | U partial pending (l.40-42); **TTL `resolvedAt`** (l.45-49) | **T** |
| Session | `sessions` | `modules/auth/session-model.ts:21,15-19` | `_id` (sid cookie), `sub` (index), `sid` (index) | **TTL `expiresAt`** (l.19-20) | sub toàn cục; cần tenant |
| LoginTransaction | `login_transactions` | `modules/auth/login-transaction.ts:24,22,81` | id giao dịch | **TTL** (l.22) | cần tenant (redirect/return host) |
| LogoutTokenJti | `logout_token_jtis` | `modules/auth/logout-token.ts:18,16` | `jti` | **TTL** (l.16) | toàn cục theo jti (an toàn) |
| TrialExtension | `trial_extension_requests` | `modules/trial/trial-extension-model.ts:27,32-39` | `userSub`, pending | U partial pending (l.32-34) | **T** |
| UsageCounter | `usage_counters` | `modules/billing/usage-counter-model.ts:21,23` | `(ownerSub,yyyymm)` | U (l.23) | **T** (quota theo owner: quyết định sản phẩm) |
| RateLimitWindow | `rate_limit_windows` | `modules/lib/rate-limit-windows.ts:18,20` (`src/lib/`) | `_id` = hash(key IP/account) | **TTL `expiresAt`** (l.20) | **G**: key IP/account không có tenant |
| Notification | `notifications` | `modules/notifications/notification-model.ts:33,36-37` | `(userSub,_id)`, `(userSub,readAt)` | không U | **T** |
| NotificationPreferences | `notification_preferences` | `modules/notifications/notification-preferences-model.ts:13,29` | `userSub` (U) | U (l.13) | **T** |
| PushSubscription | `push_subscriptions` | `modules/notifications/push-subscription-model.ts:14,21` | **`endpoint` toàn cục** | U (l.14) | **G** (cùng endpoint = cùng trình duyệt; vẫn nên có tenant) |
| ClientSettings | `client_settings` | `modules/api-client/client-settings-model.ts:28,45` | `userSub` (U) | U (l.28) | **T** |
| ClientDraft | `client_drafts` | `modules/api-client/draft-model.ts:20,26-27` | `(userSub,tabId)` | U (l.26) | **T** |
| ClientHistory | `client_history` | `modules/api-client/history-model.ts:43,46` | `(userSub,_id)` | không U | **T** |
| Feedback | `feedback` | `modules/feedback/feedback-model.ts:68,70-72` | **`(type,email)` U partial `pro_interest`** | U (l.70-72) | **G**: một email chỉ có một pro_interest trên toàn hệ thống |
| ContactMessage | **`feedback` (dùng chung collection với Feedback)** | `modules/feedback/contact-message-model.ts:38,40` | `(type,status,createdAt)` | không U | **G** (chung collection với Feedback, cần tách hoặc gắn tenantId) |
| RequestLog | `request_logs` | `modules/mock-runtime/request-log-model.ts:121,128-138` | `projectId` | **TTL `expiresAt`** (l.138) | theo project |
| AuditEvent | `audit_events` | `modules/audit/audit-event-model.ts:26,15` | `sub` (index) | không U | **T** |
| Session / audit | — | — | — | — | — |

Ghi chú:
- Số model: 41 `mongoose.model(` (grep, không tính test). Kế hoạch ghi "~43"; chênh lệch có thể do cách đếm, cần xác nhận lại.
- Khóa toàn cục có khả năng va chạm hoặc rò rỉ giữa tenant: `secret` (Project), `inviteTokenHash` (WorkspaceMember, Collaborator), `tokenHash` (MagicLink), `endpoint` (PushSubscription), `(type,email)` (Feedback pro_interest), key IP trong `rate_limit_windows`.
- `(userSub)` và `sub` là IdP-global, nên một người dùng có thể xuất hiện ở nhiều tenant. Cần quyết định: `users` có một doc toàn cục hay một doc mỗi tenant.
- Chưa kiểm: `login_transactions` (ràng buộc redirect), mọi dạng key của `rate_limit_windows` (đã thấy comment, chưa thấy key thực).

## 2. Lớp truy cập dữ liệu

- **Không có repository tập trung.** Gọi `XModel.find/findOne/...` trực tiếp, tập trung ở `*-service.ts`, `*-operations.ts`, `*-store.ts`.
- Số lượt gọi thô (grep `Model.` và `Model(`, không tính test): `UserModel` 175 (31 file), `ResourceModel` 70 (16 file), `CollectionModel` 53 (19 file), `RecordModel` 52 (17 file), `CollaboratorModel` 52 (13 file), `ProjectModel` 60 (13 file), `WorkspaceMemberModel` 43 (15 file), `CollectionRevisionModel` 43 (7 file), `ElementRoleModel` 38 (12 file), `FeedbackModel` 33 (4 file), `SessionModel` 29 (3 file), `RequestLogModel` 25 (5 file), `OutboundJobModel` 24 (6 file), `WorkspaceModel` 24 (9 file), `NotificationModel` 26 (3 file), `EnvironmentModel` 23 (7 file), `HistoryModel` 20 (2 file), `PushSubscriptionModel` 19 (4 file), `CollectionNodeModel` 52 (16 file), các model còn lại dưới 20 lượt.
- **Hệ quả:** thêm `tenantId` vào mọi truy vấn là việc rải rác, cần một lớp scope (ví dụ wrapper trả về `Model` có sẵn filter) hoặc sửa từng call site. Ước lượng: khoảng 700+ lượt gọi ở `src`.
- **Tạo index:** `db/connect-mongo.ts:72-79` `initModels()` gọi `mongoose.model(name).init()` cho mọi model và được `main.ts:148` gọi trước `listen` (l.168). Lỗi build index làm dừng khởi động. `test-support/test-mongo.ts:17-27` làm giống khi test.
- Không có `syncIndexes` và không có `createCollection` tường minh; chỉ có `init()` (autoIndex mặc định).

## 3. Cấu hình một tenant (env, config, hardcode)

| Mục | Nơi đọc (file:dòng) | Ghi chú cho multi-tenant |
|---|---|---|
| `PUBLIC_URL` | `config/env.ts:44`; origin ở `env.ts:9-15`; dùng ở `main.ts:153,160`, `auth-module.ts:54`, `runtime-settings.ts:152,165` | Gốc của redirect URI, CSRF origin, MCP resource (`localman-mcp-server.ts:163`), link của project (`project-view.ts`). Một giá trị cho toàn process. |
| `WEB_ORIGIN` | `env.ts:42`; `main.ts:153` | Đưa vào `allowedOrigins` cho CSRF và MCP (`http/csrf-guard.ts:8-21`). |
| `OIDC_ISSUER` | `env.ts:48`; `auth-module.ts:51`; `main.ts:161`; `mcp-resource-metadata.ts:46` (`authorization_servers`) | Một issuer. Giữ `auth.<domain>`. |
| `OIDC_CLIENT_ID` / `_SECRET` | `env.ts:49-50`; `auth-module.ts:52` | Một client `localman-web`. |
| `MOCK_BASE_DOMAIN` | `feature-env.ts:81` (default `localman.hoandat.com`); `runtime-settings.ts:106,151`; đọc tại `mock-http.ts:53-56`, `resolve-project.ts:61-68`, `ssrf-guard.ts:100-102`, `project-view.ts:43-45` | Đã có sẵn wildcard. Default còn hardcode `hoandat`. |
| `OWNER_SUBS`, `OWNER_TELEGRAM_CHAT_ID` | `feature-env.ts:96,98`; `runtime-settings.ts:153`; `trial-notices.ts:20` | Admin toàn cục. Cần quyết định: owner theo tenant hay toàn hệ thống. |
| `TUNNEL_DOMAINS` | `feature-env.ts:116` (default rỗng) | Đây là config của tunnel, không phải tenant. |
| `TUNNEL_RESOURCE` (hardcode) | `modules/auth/token-exchange.ts:13` = `https://tunnel.hoandat.com` | Hardcode, không đi qua env. Cần đưa ra env nếu tunnel khác theo tenant. |
| `TUNELO_TUNNEL_DOMAIN` (hardcode) | `packages/shared/src/api-client/tunnel-url.ts:8`; `apps/api/src/...` đọc qua shared | Hardcode trong `packages/shared`, dùng cả web lẫn api. |
| Turnstile | `feature-env.ts:103-104,118`; `runtime-settings.ts:159-167` (`expectedHostname` = host của `PUBLIC_URL`, l.165); `modules/feedback/turnstile-verifier.ts` | `expectedHostname` một giá trị. Form công khai trên host tenant sẽ bị từ chối nếu hostname khác. Cần `*.localman` hoặc danh sách host. |
| VAPID | `env.ts:68-73`; `env.ts:116-127` | Một cặp khóa, `VAPID_SUBJECT` là mailto/https cố định. |
| Telegram | `env.ts:74,101` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`); `notification-service.ts:179-189`; `channels/telegram-bot-client.ts:4` | Một bot toàn cục. Liên kết tài khoản (`user.telegram.chatId`) lưu theo user (`users/user-model.ts`). |
| CORS | `main.ts:153`; `mock-http.ts:22` (`*`) | Dashboard dùng danh sách tĩnh. Mock dùng `*`, không phụ thuộc host. |
| Cookie | `http/cookies.ts:13-27` (`__Host-` khi https, host-only); `auth/auth-cookies.ts:33-54` (`lm_session`, `lm_login`, `lm_sso_hint`, `lm_sso_tried`) | Cookie `__Host-` không gắn domain, nên mỗi tenant có cookie riêng. Ghi chú `auth-cookies.ts:28-32`: SameSite=Strict vì mock là subdomain cùng site. |
| CSP | `mock-server.ts:59-64` (mock, không đổi theo host); dashboard CSP trong `infra/localman/nginx/localman.hoandat.com.conf:148` | CSP dashboard nằm trong nginx, không trong code. |
| Rate limit theo IP | `http/ip-rate-limit.ts`; `mock-server.ts`; `lib/rate-limit-windows.ts` (collection `rate_limit_windows`); `config/runtime-settings.ts:110-133`; `env.ts`/`feature-env.ts:83-87` (`MOCK_RATE_LIMIT_PER_IP`, `_PER_SECRET`) | Khóa không có tenant. Thêm tenantId vào khóa hoặc chấp nhận dùng chung giới hạn. |
| `hoandat` trong code không test | `apps/api/src/config/runtime-settings.ts:106` (`localman.hoandat.com`); `config/feature-env.ts:81`; `modules/projects/project-model.ts:5`, `project-service.ts:19` (comment); `modules/users/user-operations.ts:14` (mô tả `auth.hoandat.com`); `modules/audit/security-event-token.ts:5-6` (`urn:hoandat:auth:event:` là URI sự kiện của IdP, không đổi); `modules/mock-runtime/upstream-headers.ts:38` (comment) | Chỉ các dòng code là cần đổi. Comment và URI sự kiện thuộc IdP. |
| Web | `apps/web/src/lib/app-config.ts:7` (`DEFAULT_IDP_ORIGIN = https://auth.hoandat.com`), `:38-39` (`apiBaseUrl`, `idpOrigin`), `:42` (`idpAccountUrl`); `apps/web/src/pages/docs/docs-pages.ts:51` (`MOCK_DOMAIN = localman.hoandat.com`), `:61` (`IDP_HOST`); `apps/web/src/content/landing-samples.ts:10` (URL mẫu) | `VITE_IDP_ORIGIN` được bake lúc build. |
| i18n (hoandat là tên thương hiệu IdP) | `apps/web/src/i18n/messages/{en,vi,zh-CN}/`: `layout.ts:28-33`, `auth.ts:14,29`, `invite.ts`, `workspaces.ts:91,143`, `notifications.ts:54,84`, `collaborators.ts:42`, `docs-mcp.ts:25-28` | Đây là tên tài khoản IdP. Đổi nếu brand thay đổi, không bắt buộc khi thêm tenant. |

## 4. Auth

| Phần | Vị trí | Ghi chú |
|---|---|---|
| Discovery và JWKS | `modules/auth/oidc-client.ts:75-77` (`createRemoteJWKSet(jwks_uri)`); `:94-95` `jwks()`; `:177` `post_logout_redirect_uri` | Một issuer, một JWKS. Không đổi theo host. |
| Wiring | `modules/auth/auth-module.ts:47-63` (`authSettingsFromEnv`), `:64-116` (`createAuthModule`), `:110` (audience của audit = `publicUrl` + `/internal/audit-events`) | `publicUrl` quyết định redirect URI. |
| Session | `modules/auth/session-store.ts`; `session-model.ts:8-23`; `session-refresher.ts`; `token-cipher.ts` (khóa `SESSION_ENCRYPTION_KEY` `env.ts:51-56`) | Session lưu trong Mongo, `_id` là sid của cookie, index `sub` và `sid`. |
| Đăng nhập | `modules/auth/auth-routes.ts:68-166`; `login-transaction.ts:22-81` (TTL, `expiresAt > now`); `return-to.ts`, `auth-redirects.ts` | Redirect URI và return-to phải khớp host tenant. Chưa đọc chi tiết `return-to.ts`. |
| Logout và back-channel | `modules/auth/auth-routes.ts:172-190`; `backchannel-logout-route.ts:40-98`; `logout-token.ts:54-70` (jwtVerify `audience` = clientId, `typ` `logout+jwt`) | Logout ở IdP cần biết tenant để về đúng host. |
| Token MCP (access token) | `modules/mcp/mcp-access-token.ts:60-70` (`issuer`, `audience`, `typ` `at+jwt`, `requiredClaims` sub/exp) | `audience` lấy từ tham số của caller. Chưa xác minh giá trị (xem câu hỏi mở). |
| MCP metadata | `modules/mcp/mcp-resource-metadata.ts:26,46`; `localman-mcp-server.ts:52-55,98,163-164`; `operations/protocol-routes.ts:40-41` (`/.well-known/oauth-protected-resource`, `/mcp`) | Resource = `{PUBLIC_URL}/mcp`. Multi-tenant: cần metadata theo host hoặc resource chung. |
| Audit intake (SET) | `modules/audit/audit-events-route.ts:38,64-86` (`POST /internal/audit-events`, `application/secevent+jwt`); `security-event-token.ts:45-63` (jwtVerify ES256, `issuer`, `audience`, `typ` `secevent+jwt`, `maxTokenAge`); `basic-credentials.ts`; `auth-module.ts:100-110` | Không có tenant trong event. Cần map `sub` → tenant hoặc gửi tenant trong SET. |
| Token exchange (Tunelo) | `modules/auth/token-exchange.ts:13` (TUNNEL_RESOURCE hardcode), `:70-84` (`oidc.exchangeToken(accessToken, TUNNEL_RESOURCE, TUNNEL_SCOPE)`) | Nếu tunnel theo tenant, đưa resource ra config. |
| Đồng bộ user | `modules/users/user-sync.ts:51,63,75-79,96` (`findOne({sub})`, `autoStartTrial`) | Khóa `sub`. |

Rủi ro chính: client `localman-web` có redirect URI được đăng ký cố định ở `hoandat-auth` (`src/oidc/clients.ts`, theo CLAUDE.md của repo auth). Với `*.localman.<domain>`, phải đăng ký thêm host hoặc hỗ trợ wildcard. Cần kiểm trong repo `hoandat-auth`.

## 5. Routing theo host, SSRF, job nền

- **Hai process:** dashboard `DASHBOARD_PORT` 4000 (`env.ts:34`, `main.ts:168`) và mock `MOCK_PORT` 4100 (`env.ts:35`, `main.ts:176-185`). Dashboard không đọc host để chọn tenant. Mock chọn tenant qua host.
- **Chọn project theo host:** `modules/mock-runtime/resolve-project.ts:55-86` (`readMockAddress`): host `*.{base}` có nhãn khớp `DNS_LABEL` (l.4-5) thành secret. Đường dẫn dự phòng `/m/{secret}` ở l.16, l.73-81. Bản đồ `secret → project` là `ProjectModel.findOne({secret, ...LIVE_PROJECT})` (`resolve-project.ts:131`), không phụ thuộc host.
- **Host đọc ở:** `mock-http.ts:44-60` (`readAddress`, dùng `runtimeSettings().mockBaseDomain`). Mock server gắn ở `mock-server.ts:79+`.
- **Cache project:** `TtlLruCache` trong `resolve-project.ts`. Khi có tenant, khóa cache phải kèm host hoặc tenantId.
- **SSRF guard:** `modules/api-client/ssrf-guard.ts`:
  - Cho phép IP công khai; chặn private, địa chỉ của chính server, cổng mail, DNS rebinding (l.28-40, 85-100, 113-120).
  - Mock host (`*.{MOCK_BASE_DOMAIN}`) và tunnel host (`<label>.{TUNNEL_DOMAINS}`) được phép và ép `Host` (`forceHost`, l.33-40).
  - `runtime-ssrf-guard.ts:11-16` đọc `PROXY_BLOCKED_CIDRS`, `MOCK_BASE_DOMAIN`, `TUNNEL_DOMAINS` tại mỗi lần gọi.
  - Khi có nhiều tenant, `isMockHost` (`ssrf-guard.ts:100-102`) vẫn đúng vì chỉ so hậu tố `.base`.
- **Job nền:** `background-jobs.ts:14-37`:
  - `TombstoneSweeper` (xóa project đang bị đánh dấu xóa),
  - `TrialReminderJob` (nhắc thử nghiệm),
  - `CollectionTrashJob` (purge thùng rác collection),
  - `backfillExampleSearchNames` (một lần).
  - Khởi tạo ở `main.ts:93`, start ở `main.ts:198`.
  - Ngoài ra `outboundQueue.start()` (`main.ts:175`), `usageMeter.start()` (l.173), `requestLog.start()` (l.174), `notifications.drain()` ở shutdown (l.113).
  - Các job đọc collection toàn cục, không có tenant trong context. Cần truyền `tenantId` vào từng job (ví dụ `OutboundJob` đã có `projectId` và `owner`, nhưng không có tenant).

## 6. Web app

- Biến build: `apps/web/src/vite-env.d.ts:5-9` (`VITE_API_BASE_URL`, `VITE_IDP_ORIGIN`, `VITE_FEATURES`). `apps/web/src/lib/app-config.ts:7-39`: `idpOrigin` mặc định `auth.hoandat.com`, `apiBaseUrl` rỗng (cùng origin).
- `infra/localman/deploy.sh:46`: `export VITE_IDP_ORIGIN="${VITE_IDP_ORIGIN:-https://auth.hoandat.com}"`.
- Không có "runtime config fetch": cấu hình được bake lúc build. Với multi-tenant, host hiện tại chỉ dùng để gọi API cùng origin, còn `idpOrigin` là một giá trị. Nếu IdP cố định là `auth.<domain>`, không cần đổi build; chỉ cần đổi nếu domain đổi.
- `apps/web/src/features/api-client/routing/client-settings-api.ts:24,36` và `routing-test-utils.tsx:17`: domain tunnel hardcode trong code web.
- Brand: `apps/web/src/i18n/messages/*/layout.ts:28-33` (nút mở tài khoản IdP), `docs-pages.ts:51,61`, `landing-samples.ts:10`. Tên "Localman" xuất hiện nhiều (xem `features/*`), không liệt kê hết.
- Cookie `lm_sso_hint` và `lm_sso_tried` đọc từ web (`auth-cookies.ts:44-54`), httpOnly=false.

## 7. Vận hành

| Mục | File:dòng | Ghi chú |
|---|---|---|
| Wildcard cert | `infra/localman/issue-wildcard-cert.sh:2,15,21,61`: `DOMAIN=localman.hoandat.com`, Cloudflare token Zone:DNS:Edit trên `hoandat.com` | Chứng chỉ phủ `localman.<domain>` và `*.localman.<domain>`. Đổi domain phải cấp lại. |
| Gia hạn cert chung | `infra/tunelo/certbot-setup.sh:2-8` (cùng token, cũng "renews localman.hoandat.com") | Phụ thuộc chéo với tunelo. |
| Nginx | `infra/localman/nginx/localman.hoandat.com.conf:1-9` (mô tả), `:24` và `:52` (`server_name` gồm `*.localman.hoandat.com`), `:37-39` (server từ chối `www`, `api`, `app`, `admin`, `mail`), `:41-42,54-55` (cert), `:103-104` (log), `:146-148` (CSP), `:247` (`/m/` fallback) | Cần tách rõ block dashboard (`localman.<domain>`) và block mock (`*.localman.<domain>`). Đang cùng file. |
| Nginx http | `infra/localman/nginx/localman-http.conf:4-15` (real-IP, rate limit `*.localman.hoandat.com`) | |
| Activate | `infra/localman/activate-release.sh:29` (file nginx `localman.hoandat.com.conf`) | Đổi tên file nếu đổi domain. |
| Switch release | `infra/localman/switch-release.sh:32,85-88` (`--resolve localman.hoandat.com:443:127.0.0.1`, curl `/` và `/api/v1/openapi.json`); `:73-80` (chờ healthz **tối đa 30 lần × sleep 1 = 30 s**) | Thời gian chờ: 30 giây. Smoke test cần thêm host tenant. |
| Deploy | `infra/localman/deploy.sh:46,73-75` (VITE_IDP_ORIGIN, file nginx theo domain) | |
| Env production | `infra/localman/.env.production.example:25-26,32,47,52-55,62,71,76-78,89`: `PUBLIC_URL`, `WEB_ORIGIN`, `OIDC_ISSUER`, `VAPID_SUBJECT` (`mailto:admin@hoandat.com`), `TELEGRAM_BOT_USERNAME`, Turnstile "for localman.hoandat.com", `/internal/audit-events`, `MOCK_BASE_DOMAIN`, `TUNNEL_DOMAINS` | Tệp mẫu chứa domain. |
| Script khác | `infra/localman/setup-mongo-localman.sh`, `backup-localman-db.sh`, `csp-hashes.mjs`, `runtime-manifest.mjs`, `ecosystem.config.cjs`, `setup-server.sh`, `released-features/` | Chưa đọc chi tiết. |

## 8. Hạ tầng kiểm thử

| Mục | Vị trí | Ghi chú |
|---|---|---|
| Mongo cho test | `apps/api/src/test-support/mongo-global-setup.ts` (`MongoMemoryReplSet`); `test-mongo.ts:17-27` (một DB `lm_<uuid>` mỗi test, `initModels` tương đương) | Đủ để tạo nhiều tenant trong một DB (thêm `tenantId`). |
| App test | `apps/api/src/test-support/dashboard-test-app.ts` | |
| Mock test | `apps/api/src/modules/mock-runtime/testing/mock-test-kit.ts:20` (`MOCK_DOMAIN = "localman.test"`), `:67` (`mockBaseDomain`), `:98` (`.set("host", `${secret}.${MOCK_DOMAIN}`)`) | Đã giả lập host theo secret. Cần thêm nhiều tenant qua host. |
| Auth test | `apps/api/src/modules/auth/testing/`: `fake-idp.ts`, `fake-idp-dcr.ts` (comment `auth.hoandat.com` l.21), `fake-token-exchange.ts`, `auth-harness.ts` | |
| E2E | `e2e/support/stack.ts:31` (`TUNNEL_DOMAIN = tunnel.hoandat.com`), `:33` (`API_ORIGIN`), `:66-68` (`PUBLIC_URL`, `WEB_ORIGIN`, `OIDC_ISSUER`), `:74` (`MOCK_BASE_DOMAIN`), `:111-113` (MongoMemoryReplSet ở `PORTS.mongo`) | |
| Cổng và host e2e | `e2e/support/ports.ts:16-23` (`WEB_ORIGIN` = 127.0.0.1:port, `MOCK_BASE_DOMAIN = localhost:${PORTS.mock}`) | Hai tenant giả: dùng `a.localhost:<port>` (trình duyệt phân giải `*.localhost` về 127.0.0.1; Node có thể không phân giải, cần `--resolve` hoặc header Host). |
| Playwright | `e2e/playwright.config.ts` | Chưa đọc chi tiết. |

## 9. Đề xuất chia phase (kích thước theo tier, không ước lượng giờ)

Thứ tự giữ `hoandat.com` chạy ở mọi bước. Mỗi phase có default bằng giá trị hiện tại.

| Phase | Tier | Nội dung | Điều kiện giữ hoandat.com |
|---|---|---|---|
| P0 | S | Thêm `TENANT_*` hoặc một hàm `tenantOf(host)` mặc định trả về tenant hiện tại. Không đổi hành vi. | Mặc định khớp `MOCK_BASE_DOMAIN` hiện tại. |
| P1 | M | Thêm `tenantId` vào model và index: `initModels`, mọi unique index đổi thành `(tenantId, …)`. Migration backfill `tenantId = "default"` cho dữ liệu cũ. Ghi thay đổi qua `AuditOutbox` không đổi. | Backfill trước khi bật unique mới; giữ index cũ đến khi xong. |
| P2 | M | Lớp scope truy vấn: wrapper hoặc tham số `tenantId` cho ~41 model, sửa call site theo nhóm (projects, mock, users, collections, notifications, feedback). | Tenant mặc định giữ hành vi cũ. |
| P3 | M | Routing theo host: `readMockAddress` và `resolve-project` thêm tenant; `runtimeSettings` từ singleton sang `tenantSettings(host)`; `configureRuntime` đổi thành đăng ký theo tenant. | Singleton `DEFAULT` vẫn là hoandat. |
| P4 | M | Auth: session, login transaction, return-to, back-channel, audit intake (map SET → tenant), MCP metadata theo host. | Cần IdP đăng ký redirect URI cho `*.localman.<domain>` (việc ở repo hoandat-auth). |
| P5 | S | Background job và queue nhận `tenantId` trong context (tombstone, trial, trash, outbound, usage meter, request log). | |
| P6 | S | Web: `idpOrigin` và domain tunnel theo build; i18n không đổi. | |
| P7 | S | Ops: nginx block `*.localman.<domain>`, cert, `switch-release.sh` (thêm smoke test host tenant, giữ 30 s chờ hoặc tăng). | |
| P8 | M | Test: mở rộng `mock-test-kit` và e2e stack để có hai tenant (`a.localhost`, `b.localhost`). | |

Rủi ro xếp theo mức: (1) đăng ký redirect URI ở IdP, (2) quyết định `users` và quota theo tenant, (3) unique toàn cục (Feedback pro_interest, invite token), (4) Turnstile hostname.

## Câu hỏi mở

- `apps/api/src/modules/mcp/mcp-access-token.ts` nhận `audience` từ caller; giá trị đúng cần đọc ở nơi gọi (`localman-mcp-access.ts`, `resources.ts`).
- `rate_limit_windows`: cần đọc cách tạo khóa (`lib/rate-limit-windows.ts` và các caller) để biết có tenant trong khóa không.
- `login_transactions`: `return-to.ts` và `auth-redirects.ts` chưa đọc chi tiết.
- Nginx `localman.hoandat.com.conf:24` và `:52`: cần xác nhận block nào xử lý `localman.<domain>` và block nào cho `*.localman`.
- `ContactMessage` và `Feedback` dùng chung collection `feedback`: xác nhận đây là chủ ý hay lỗi (đã thấy `contact-message-model.ts:38`, `feedback-model.ts:68`).
- Có muốn `owner`/`OWNER_SUBS` và quota theo tenant hay toàn hệ thống? Đây là quyết định sản phẩm.
