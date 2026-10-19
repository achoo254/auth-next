---
phase: 1
title: "Client chat và mô hình tenant"
status: done
priority: P1
effort: "L"
dependencies: []
---

# Phase 01: Client chat và mô hình tenant

## Goal

Thêm ba client tĩnh `chat-web`, `chat-mobile`, `chat-desktop` cho mọi tenant, cùng địa chỉ web app chat trong mô hình tenant. Cần làm xong ba việc: đăng nhập web chạy được, client native nhận refresh token không trần 90 ngày, và secret của `chat-web` suy được theo tenant như Localman và Tunelo.

## Phạm vi

- **Mô hình tenant:**
  - Thêm `chat` vào `Tenant.webApps` (`src/tenants/tenant.ts:26`).
  - Thêm vào `webAppsFor` (`src/tenants/tenant-resources.ts:24-30`), `tenantFromDocument` (`src/tenants/tenant-runtime.ts:79-88`) và `envTenant` (`src/tenants/env-tenant.ts:18-36`).
  - Tenant sổ có `webApps.chat = https://chat.<d>`.
- **Env:**
  - Thêm `CHAT_WEB_URL` và `CHAT_WEB_CLIENT_SECRET` vào `src/config/env.ts` (`PRODUCTION_URLS` `:35-38`, giá trị mặc định `:83-86`), `envClientSecrets` (`src/tenants/env-tenant.ts:39-46`) và `.env.example`.
  - Thiếu hai biến này thì process báo tên biến và thoát, như hai client hiện có.
- **Client** (`src/oidc/clients.ts`):
  - `STATIC_CLIENT_IDS` thêm `chatWeb: "chat-web"`, `chatMobile: "chat-mobile"`, `chatDesktop: "chat-desktop"`.
  - `chat-web`:
    - confidential, `client_secret_basic`, grant `authorization_code` + `refresh_token`;
    - redirect `${chat}/auth/callback`, post-logout `${chat}/`;
    - back-channel logout `${chat}/auth/backchannel-logout` với `backchannel_logout_session_required: true`;
    - scope `openid profile email`;
    - thêm vào `SESSION_BOUND_STATIC_CLIENTS`; không thêm vào `TRUSTED_INTROSPECTION_CLIENT_IDS`.
  - `chat-mobile`:
    - `application_type: "native"`, `token_endpoint_auth_method: "none"`, grant `authorization_code` + `refresh_token`, scope `openid profile email`;
    - redirect private-use scheme lấy từ env `CHAT_MOBILE_REDIRECT_URI`, mặc định `com.hoandat.chat:/auth/callback`.
    - Scheme phải khớp `brand.config.json` của app chat. Đó là giá trị build-time của app và dùng chung mọi tenant.
  - `chat-desktop`: như `chat-mobile`, redirect `http://127.0.0.1/auth/callback`. oidc-provider bỏ qua cổng loopback cho client `native` (RFC 8252 mục 7.3; đã đối chiếu `#redirectAllowed` trong `lib/models/client.js` upstream). Kiểm lại trên bản đang cài bằng test ở phase này.
  - `StaticClientSecrets` thêm `chatWeb`.
- **Resource rỗng:** `src/oidc/registration-policy.ts:195-203` chỉ cho `hoandat-account` có `allowed_resources` rỗng. Mở cho ba client chat, vì chat không có audience API.
- **Refresh token native:**
  - `issueRefreshToken` (`src/oidc/provider.ts:150-153`) cấp refresh token cho `chat-mobile`/`chat-desktop` theo chính sách client. Không cần `offline_access`, nên không cần `prompt=consent`.
  - Refresh token native không gắn phiên trình duyệt: không thêm vào `SESSION_BOUND_STATIC_CLIENTS`.
- **Trần 90 ngày:** `hasHardCap` (`src/oidc/sliding-grants.ts:20-22`) đổi từ so sánh một id sang một tập miễn trần `{tunelo-cli, chat-mobile, chat-desktop}`.
- **Consent native first-party** (`src/interactions/consent-handler.ts:156-183`):
  - Client tĩnh native hiện trang duyệt. Với `chat-*` native, trang dùng câu first-party "Cho phép {app} trên máy này?" (3 ngôn ngữ), không có nhãn "Ứng dụng bên ngoài" hay cảnh báo mạo danh.
  - Grant được lưu, nên lần sau trên cùng máy không hỏi lại.
- **Secret suy theo tenant:**
  - `derivedClientSecrets` (`src/tenants/app-client-secrets.ts:35-51`) thêm `chatWeb`.
  - `scripts/app-client-key.ts:16-19` thêm `chat-web` vào `APPS`.
  - Khoá app của `chat-web` riêng, không dùng chung với `localman-web`/`tunelo-web`.
- **Cảnh báo mạo danh:** `src/oidc/first-party-name.ts:2` thêm `chat` để tên DCR giống app chat bị cảnh báo trên trang consent.

## Verification

- Unit/integration:
  - discovery của tenant chính và tenant sổ có ba client chat;
  - `chat-web` đăng nhập, refresh, đăng xuất ở IdP rồi refresh nhận `invalid_grant`;
  - back-channel logout tới `chat-web` có `sid`;
  - `chat-desktop` với redirect `http://127.0.0.1:53123/auth/callback` (cổng chưa khai) được chấp nhận, `http://localhost.evil/...` và `https://127.0.0.1/...` bị từ chối;
  - `chat-mobile` với scheme khác bị từ chối;
  - refresh token native không chết khi đăng xuất ở IdP, và qua ngày 90 vẫn refresh được (đồng hồ giả);
  - `chat-web` vẫn có trần 90 ngày.
- Test sửa theo: `src/__tests__/client-contract.test.ts`, `src/__tests__/sliding-grants.test.ts:138-149`, `src/config/env.test.ts:12-13`, `src/__tests__/seed-clients.test.ts:94`, snapshot `primary-tenant-snapshot` (chỉ phần client chat thay đổi).
- `pnpm seed:clients --skip-discovery` liệt kê đủ ba client chat.

## Risks

- `issueRefreshToken` cấp refresh token cho client public: chỉ áp cho đúng hai client native đã khai, có PKCE; test cho client DCR không được hưởng.
- Đổi `hasHardCap` thành tập: giữ nguyên hành vi `tunelo-cli`, có test hồi quy.

## Kết quả (2026-10-14)

- Commit `0c0020d` trên nhánh `feat/chat-app-clients` (chưa push, chưa merge; merge khi Phase 04 deploy). Cổng kiểm sạch: `pnpm lint` (302 file), `pnpm typecheck`, `pnpm check:tokens` (282 file), `pnpm test` (74 file, 501 test), `pnpm test:e2e` (10 test).
- Code mới:
  - `src/oidc/chat-clients.ts`: ba client chat cùng redirect native.
  - `refreshesPerDevice` và `CLIENTS_WITHOUT_RESOURCES` trong `src/oidc/clients.ts`.
  - `expiresWithSession` trong `src/oidc/provider.ts`.
  - Test `src/__tests__/chat-clients-flow.test.ts` (6 test): web đăng nhập, back-channel và refresh chết khi đăng xuất IdP; mobile qua trang duyệt first-party và giữ refresh sau đăng xuất IdP; desktop nhận cổng loopback bất kỳ; 4 redirect sai bị từ chối (400); không trần 90 ngày.
- Snapshot `primary-tenant-snapshot` chỉ thêm 78 dòng của ba client chat, không dòng nào của client cũ đổi.
- Khác với phạm vi ban đầu:
  - **Không thêm `chat` vào `first-party-name.ts`.** Hàm so khớp theo chuỗi con, nên mọi client DCR có chữ "chat" trong tên (ví dụ "ChatGPT") sẽ bị cảnh báo mạo danh nhầm. Tên sản phẩm chat lại cấu hình được, nên chưa có tên cố định để so.
  - **Trang duyệt native dùng lại trang consent first-party sẵn có** (tiêu đề `consent.titleForApp`, không có nhãn "Ứng dụng bên ngoài"). Không thêm chuỗi i18n mới. oidc-provider luôn hỏi lại với client native, nên trang này hiện ở mỗi lần đăng nhập trên máy, không chỉ lần đầu.
  - **Redirect mobile đọc từ env `CHAT_MOBILE_REDIRECT_URI`** (mặc định `com.hoandat.chat:/auth/callback`, kiểm dạng private-use scheme RFC 8252 §7.1). Jev chọn hướng này (0.92) ngày 2026-10-14, để đổi tên app chỉ cần đổi cấu hình ở cả hai phía. Ban đầu redirect là một hằng.
  - **Refresh token native không chết theo phiên IdP** nhờ cấu hình `expiresWithSession` của oidc-provider. Nếu thiếu cấu hình này, token không có `offline_access` sẽ bị thu hồi khi đăng xuất ở trình duyệt.
- **Lưu ý deploy:** `CHAT_WEB_CLIENT_SECRET` là biến bắt buộc mới. Deploy commit này lên `.65` mà chưa thêm biến vào `.env` thì IdP không khởi động. Phase 04 lo bước này, nên đừng deploy riêng phase này trước.

