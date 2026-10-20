---
phase: 2
title: "Client account-ios và API /api/account"
status: pending
priority: P2
effort: "L"
dependencies: [1]
---

# Phase 02: Client `account-ios` và API `/api/account`

## Goal

IdP có một public client native `account-ios` (chỉ tenant chính) và một API JSON để app làm mọi việc của `/account`, xác thực bằng access token opaque của chính client đó. Logic ghi và audit dùng chung với route web; guard không bao giờ yếu hơn web.

## Bối cảnh đã đo

- **Client native mẫu:** `chat-clients.ts:37-52`; `scribe-mobile` chỉ có ở tenant chính (`scribe-clients.ts:92,100-112`).
- **Client có `allowed_resources: []`** phải nằm trong `CLIENTS_WITHOUT_RESOURCES` (`src/oidc/clients.ts:91-95`). Nếu không, `registration-policy.ts:194-205` ném lỗi khi dựng provider.
- **Kích thước file:** `clients.ts` đã 200 dòng, `src/http/security.ts` 204, `src/oidc/provider.ts` 214.
- **Trần 90 ngày:** `hasHardCap()` (`src/oidc/sliding-grants.ts:21-25`) bỏ trần cho client thiết bị.
- **Scope mới:** thêm `account` vào `SUPPORTED_SCOPES` (`src/oidc/resources.ts:39-47`, mẫu `TELEGRAM_SCOPE`). Token opaque sẽ mang scope này (`grant_authorization.js:53-55` của oidc-provider 9.12.2). DCR vẫn chặn nhờ `DCR_ALLOWED_SCOPES` (`registration-policy.ts:132`).
- **Kiểm token mẫu:** `loadSubject` (`src/oidc/token-exchange.ts:46-61`): `AccessToken.find`, từ chối JWT, `grant.clientId` và `grant.accountId` khớp.
- **Guard của web:**
  - `write`: CSRF.
  - `sensitive`: CSRF + đăng nhập trong 10 phút (`account-routes.ts:57-58`). Gồm link/unlink provider (`account-access-routes.ts:27-29,44`), gỡ quyền ứng dụng (`account-confirm-routes.ts:72-74`), đăng xuất phiên khác (122-125, tính theo `sessionUid` của phiên trình duyệt, `portal-session.ts:20-25`).
- **Liên kết provider:**
  - `finishAccountLink` đòi phiên IdP trong cookie (`src/interactions/upstream-account-link.ts:38-42`) và redirect cứng về `/account` (83).
  - Purpose upstream khai báo ở `src/interactions/upstream-start.ts:5`.
  - Callback duy nhất: `src/interactions/upstream-callback.ts:142`.
- **Grant khi đăng nhập lại:** client thiết bị luôn tạo grant mới (`consent-handler.ts:56-64`, `grant-builder.ts:40-41`) và audit `grant.created`.
- **auth_time:** repo không dùng `require_auth_time`/`max_age` ở đâu. Đọc docs `oidc-provider` v9 để khai đúng.
- **Rate limit:** limiter hiện có khoá theo `tenant|IP`, tra path chính xác (`src/http/security.ts:105-127`), chạy ở dispatcher trước app (`src/http/tenant-dispatcher.ts:83`). Chưa có limiter theo tài khoản.

## Thiết kế

### Client `account-ios`

- Khai ở `src/oidc/account-ios-client.ts`, tự export id và các tập (device-bound, without-resources), giống `chat-clients.ts`; `clients.ts` chỉ spread vào.
- `token_endpoint_auth_method: none`, PKCE bắt buộc.
- `grant_types: [authorization_code, refresh_token]`.
- `scope: "openid profile email account"`, `allowed_resources: []`.
- `require_auth_time: true`.
- `redirect_uris: [<issuer>/ios/callback, <issuer>/ios/linked]`.
- Gắn thiết bị nhưng giữ trần 90 ngày (sửa `hasHardCap`).
- Chỉ có ở tenant chính.

### AASA và callback

- `GET /.well-known/apple-app-site-association`, chỉ tenant chính và chỉ khi có env `IOS_APP_ID` (dạng `<TEAMID>.com.hoandat.account`).
- Nội dung: `applinks` khớp `/ios/*` và `webcredentials.apps`.
- Trả `Content-Type: application/json`, không redirect.
- `GET /ios/callback` và `/ios/linked` (khi mở bằng trình duyệt thường) trả trang tĩnh "mở app Tài khoản" với `Cache-Control: no-store` và `Referrer-Policy: no-referrer`, không tài nguyên ngoài, không đổi code.

### Xác thực API (`src/account-api/bearer-auth.ts`)

- Đọc `Authorization: Bearer`.
- Áp đủ các kiểm của `loadSubject`:
  - token opaque còn sống;
  - `clientId === "account-ios"`;
  - grant còn, cùng client và cùng tài khoản;
  - scope có `account`.

  Sau đó `findActiveById` trong tenant của request.
- Không cookie, không CSRF.
- Lỗi theo RFC 6750 (`WWW-Authenticate`).
- Không log header.

### Đăng nhập lại (`src/account-api/recent-auth.ts`)

- Thao tác `sensitive` cần body có `id_token` do IdP ký, kiểm bằng `jose` với JWKS của tenant:
  - `aud = account-ios`;
  - `sub` khớp;
  - `auth_time` ≤ 10 phút;
  - mỗi `id_token` chỉ dùng một lần (lưu `jti` hoặc hash trong `one_time_tokens` tới khi hết hạn).
- App lấy `id_token` bằng lượt authorize `prompt=login`. Sau khi đổi code, app chuyển sang token mới rồi gọi `/token/revocation` cho refresh token cũ (grant cũ chết theo `provider-events.ts`).

  Mỗi máy vì thế chỉ còn một grant. Phase 04 có test đếm grant.

### Bảng guard

| Web route (guard) | API | Guard API |
|---|---|---|
| `GET /account` | `GET /api/account` | bearer |
| `POST /account/profile` (write) | `PATCH /api/account/profile` | bearer |
| `POST /account/sessions/:uid/revoke` (write) | `POST /api/account/sessions/:uid/revoke` | bearer |
| `POST /account/devices/:grantId/revoke` (write) | `POST /api/account/devices/:grantId/revoke` | bearer |
| `POST /account/apps/:clientId/revoke` (sensitive) | `POST /api/account/apps/:clientId/revoke` | bearer + đăng nhập lại |
| `POST /account/sessions/revoke-others` (sensitive) | `POST /api/account/sessions/revoke-all` (mọi phiên trình duyệt, app không có phiên) | bearer + đăng nhập lại |
| `POST /account/unlink/:provider` (sensitive) | `POST /api/account/providers/:provider/unlink` | bearer + đăng nhập lại |
| `POST /account/link/:provider` (sensitive) | `POST /api/account/providers/:provider/link` | bearer + đăng nhập lại |
| `POST /account/delete` (sensitive) | `DELETE /api/account` | bearer + đăng nhập lại |

Guard đặt ở tầng route, có test riêng cho từng dòng. Thân xử lý dùng chung trong `src/account-portal/account-actions.ts`: nhận account và tham số, trả kết quả có kiểu, tự ghi audit.

### Liên kết provider từ app

- `POST /api/account/providers/:provider/link` (đã qua đăng nhập lại) cấp một state upstream qua `accountTokens.issue("upstream-link-state", …)`, purpose mới `link-app`. State này:
  - gắn `accountId`, `securityVersion` và `grantId` của access token;
  - dùng một lần, sống 5 phút.

  API trả URL `GET /oauth/<provider>/start?state=…` để app mở trong `ASWebAuthenticationSession`.
- Ở callback upstream, nhánh `link-app` hoàn tất bằng `take` state, không đọc phiên portal. Nó gọi `linkUpstream` với `version` của state (ghi có điều kiện), ghi audit và thông báo giống web, rồi redirect `303` về `<issuer>/ios/linked?result=…`.
- Nhánh này không bao giờ tạo `oidc_session` hay cookie phiên IdP. Đây là thay đổi điều kiện của luồng liên kết, nên ghi vào ADR 0009 (mục "Liên kết từ app").

### Rate limit

Code mới trong router `/api/account`:
- một limiter theo IP cho cả prefix;
- một limiter theo `tenant|accountId` đặt sau `bearer-auth`;
- luật chặt hơn cho các thao tác đăng nhập lại và link.

## Files to Create / Modify

- Create:
  - `src/oidc/account-ios-client.ts`;
  - `src/account-api/bearer-auth.ts`, `recent-auth.ts`, `account-api-routes.ts`, `account-api-view.ts` (DTO JSON, danh sách khoá cho phép), `account-api-limits.ts`;
  - `src/http/apple-app-site-association.ts`, `src/http/ios-callback-page.ts`;
  - `src/account-portal/account-actions.ts`.
- Modify:
  - `src/oidc/clients.ts`, `src/oidc/resources.ts`, `src/oidc/sliding-grants.ts`, `src/oidc/client-seed.ts`;
  - `src/config/env.ts` (`IOS_APP_ID` tuỳ chọn), `.env.example`;
  - `src/account-portal/account-routes.ts`, `account-access-routes.ts`, `account-confirm-routes.ts`: gọi `account-actions.ts`;
  - `src/interactions/upstream-start.ts`, `upstream-callback.ts`, `upstream-account-link.ts`: purpose `link-app`;
  - `src/app.ts`: gắn router `/api/account` và AASA cho tenant chính. `express.json` chỉ trong router này, không parse body trước `oidc-provider`.
- Tách `src/http/security.ts` nếu phải sửa (đang 204 dòng).
- Tests:
  - `account-ios-client-flow.test.ts`:
    - code flow + PKCE;
    - refresh xoay vòng;
    - trần 90 ngày;
    - `auth_time` có trong `id_token`;
    - không có ở tenant sổ.
  - `account-api.test.ts`, cho mỗi endpoint:
    - thành công;
    - token của client khác;
    - token đã thu hồi;
    - grant của client khác;
    - thiếu scope;
    - tenant khác;
    - `id_token` cũ, sai `aud` hoặc dùng lại;
    - 429 trên path có tham số.
  - `account-actions.test.ts`: web và API cho cùng audit.
  - `account-link-app.test.ts`:
    - không có cookie phiên vẫn liên kết được;
    - không tạo `oidc_session`;
    - state dùng lại hoặc `securityVersion` đã đổi đều bị từ chối;
    - không làm tài khoản mất cách đăng nhập.
  - `apple-app-site-association.test.ts`: có cả `applinks` và `webcredentials`; thiếu `IOS_APP_ID` thì 404.
  - `account-api-contract.test.ts`: so JSON của `GET /api/account` với fixture `ios/AccountAppTests/Fixtures/account.json`; fixture này phase 04 dùng để decode.
  - Cập nhật `client-contract.test.ts`, `seed-clients.test.ts`, `sliding-grants.test.ts`, snapshot.

## Steps

1. Tách `account-actions.ts` khỏi route web; chạy lại test hiện có của `/account` để chắc không đổi hành vi.
2. Client, scope, `require_auth_time`, AASA, trang callback; test luồng.
3. Bearer auth, đăng nhập lại, limiter; test.
4. Endpoint theo bảng guard.
5. Purpose `link-app`.
6. README: bảng client, mục "Lưu ý cho client".
7. Local: lint, typecheck, test các file trên. Push và chờ CI.

## Validation

- Access token của `chat-mobile` gọi `/api/account` thì nhận 403. Token `account-ios` sau khi thiết bị bị thu hồi ở web thì nhận 401 ngay.
- `GET /api/account` không chứa `revocationToken`, `providerDetails` thô hay `securityVersion` (test theo danh sách khoá cho phép).

## Risk / Rollback

- **Bề mặt tấn công mới:** scope riêng cho một client, PKCE, đăng nhập lại cho mọi thao tác `sensitive`, `id_token` dùng một lần, rate limit theo tài khoản, không có đường nào từ bearer ra phiên IdP.
- **Lùi:** gỡ client khỏi `buildStaticClients` (grant còn lại vô hiệu) và gỡ router.
