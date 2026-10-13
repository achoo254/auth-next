# CLAUDE.md

`hoandat-auth`: IdP OpenID Connect tại `auth.hoandat.com` (oidc-provider v9 + Express 5 + MongoDB, database `auth`). Plan nằm ở repo `localman-next`: `plans/dattqh/261008-1325-central-auth-idp/`. Quyết định kiến trúc: `docs/decisions/0001-own-oidc-idp.md`, `docs/decisions/0002-accounts-and-login-pages.md`, `docs/decisions/0003-token-exchange-and-audit-outbox.md`, `docs/decisions/0004-upstream-only-sign-in.md` (chỉ Google/GitHub, không mật khẩu), `docs/decisions/0006-tenants-by-domain.md` (tenant theo domain, `tenantId`). Hợp đồng với app tích hợp: `docs/integration-guide.md`.

Commands: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check:tokens`, `pnpm generate-key`, `pnpm seed:clients` (chỉ đọc; kiểm client tĩnh và discovery). Trước khi báo xong phải sạch `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens`. Máy dùng chung: vitest đã giới hạn 2 worker trong `vitest.config.ts`, Playwright 1 worker; không chạy hai bộ test cùng lúc. `pnpm test -- <args>` không chuyển tham số, viết `pnpm test <args>`.

## Quy tắc bảo mật
- **Không log secret hay token**: không log client secret, cookie, header `authorization`, access/refresh/ID token, authorization code, device code, mật khẩu, khoá ký. Logger pino đã redact các trường này; đừng thêm log làm lộ chúng.
- **Không commit `secrets/` hay `.env`**. Khoá ký chỉ nằm trong file secret mount read-only.
- **Không gửi email**: không thêm nodemailer, SMTP hay dịch vụ mail. `grep -ri "nodemailer\|smtp" src` phải rỗng.
- Không có đường auto-login nào ngoài test: `src/__tests__/helpers/auto-interactions.ts` và upstream giả `src/__tests__/helpers/fake-upstreams.ts` chỉ được import từ test và `e2e/`.
- Không log mã liên kết Telegram, state/code của Google/GitHub. Error handler vẫn che path `/reset/<token>` của link đặt lại mật khẩu cũ.
- Đăng nhập và đăng ký chỉ qua Google/GitHub (ADR 0004). Không thêm lại mật khẩu, mã khôi phục hay đường đăng nhập nào khác mà không có ADR mới. Các trường cũ `passwordHash`, `recoveryCodeHashes`, `recoveryCodesCreatedAt`, `credentialsChangedAt`, `securityReviewPendingSince` còn trong MongoDB nhưng cố ý không có trong `AccountDocument`: không đọc chúng.
- Không được để tài khoản mất cách đăng nhập: huỷ liên kết Google/GitHub chỉ khi còn provider khác đã liên kết và đang bật (`usableSignInProviders` ở route, điều kiện "provider kia còn liên kết" trong `AccountLinks.unlinkProvider`).
- Thao tác nhạy cảm ở `/account` dùng `portalRoute(..., { csrf: true, recentLogin: true })`.
- Token một lần gắn với tài khoản chỉ được cấp/đọc qua `services.accountTokens` (kiểu `AccountTokenKind`); nó tự kiểm `securityVersion` và kênh. Mọi thay đổi bảo mật mới trên tài khoản phải `$inc: { securityVersion: 1 }` trong cùng câu cập nhật ở tầng repository. Thao tác ghi được phép bởi token thì truyền `version` mà `peek`/`take` trả về xuống phương thức repository (ghi có điều kiện, nhận `GuardedWrite`; `applied: false` thì coi như token hết hạn). 
- Mọi lần hoàn tất đăng nhập trong interaction gọi `finishLogin` (ghi `login.succeeded`).
- `email_verified` chỉ `true` khi Google/GitHub xác minh.
- Đổi cấu hình provider thì đọc docs `oidc-provider` đúng major đang dùng trước; API đổi theo major.

## Audit
- Sự kiện credential chỉ ghi qua `AuditOutbox.record` (kiểu trong `src/audit/audit-events.ts`), **sau** thao tác bảo mật mà nó mô tả (thu hồi, liên kết...), trong cùng request. `record` không bao giờ ném lỗi (lỗi chỉ được log, không kèm dữ liệu): audit không được làm hỏng bước bảo mật. Sự kiện của endpoint `oidc-provider` (thu hồi, đăng xuất) ghi qua listener trong `src/audit/provider-events.ts`. Liên kết/gỡ phương thức, email bị lấy lại được ghi ở tầng dữ liệu (`AccountLinks`); đăng nhập ở `finishLogin`; thu hồi ở route thu hồi của `/account`. Thêm thay đổi bảo mật mới thì thêm loại sự kiện và ghi ở cùng tầng.
- Dữ liệu sự kiện không bao giờ chứa mã, token, link hay secret; dispatcher không đọc hay log body phản hồi.

## Hợp đồng với client
- Token exchange (RFC 8693) chỉ cho `localman-web`, đích chỉ `https://tunnel.hoandat.com`, scope chỉ `tunnels:read`, subject token phải là access token opaque còn sống của chính client (`src/oidc/token-exchange.ts`). Lỗi về subject token là `invalid_request` theo RFC 8693 §2.2.2.
- Scope `telegram` chỉ cho `localman-web`; `telegram_chat_id`, `telegram_username` chỉ ra ở userinfo (`profileToClaims` bỏ chúng khi `use` khác `userinfo`). Claim liên lạc mới nào cũng theo cách đó.
- Client tĩnh chỉ khai báo ở `src/oidc/clients.ts` (không ghi vào MongoDB); `scripts/seed-clients.ts` chỉ kiểm.
- `localman-web` và `tunelo-web` không có `offline_access`: refresh token của chúng, như của client MCP, gắn với phiên IdP (`refreshesWithSession`), nên đăng xuất ở IdP giết grant, refresh và token exchange của Localman (Jev 0.94).
- Refresh token xoay vòng và dùng một lần; client phải khoá khi refresh (Tunelo CLI: file lock) vì hai refresh song song thì một cái nhận `invalid_grant`. Phiên trượt: mỗi refresh gia hạn grant thêm 30 ngày, trần cứng 90 ngày từ lúc đăng nhập (`src/oidc/sliding-grants.ts`), trừ thiết bị `tunelo-cli` (không trần, `hasHardCap`; tên thiết bị ở `grant_meta` trượt cùng grant).
- Chi tiết cho app tích hợp nằm ở README, mục "Lưu ý cho client".

## Trang render phía server
- Mọi HTML đi qua template `html` trong `src/ui/html.ts` (tự escape); `trustedHtml` chỉ cho markup do `oidc-provider` sinh ra. Không nối chuỗi HTML thô.
- Không có inline script hay inline style (CSP `script-src 'self'`, `style-src 'self'`). Màu chỉ lấy từ biến trong `static/css/tokens.css` (bản sao của Localman, sửa bằng cách chép lại cả file); `pnpm check:tokens` chặn mã màu ở chỗ khác.
- Mọi form POST có CSRF qua `services.csrf` với đúng phạm vi: `csrfScope(uid)` cho interaction, `portalCsrfScope` cho `/account`. Body form chỉ parse trong router của trang (`parseForm`), không bao giờ trước `oidc-provider`.
- Route của interaction phải nằm dưới `/interaction/:uid/...` vì cookie interaction gắn với path đó; luôn đọc interaction qua `loadInteraction` (kiểm cookie và uid).
- Google/GitHub chỉ đi qua interface `UpstreamClient` (`src/accounts/upstream-client.ts`), cài bằng `openid-client` trong `upstream-google.ts`, `upstream-github.ts`; luôn PKCE + state, Google thêm nonce. Test thay Google/GitHub bằng fetch giả, không gọi mạng thật.

## Tenant (ADR 0006)
- Mọi document của IdP mang `tenantId`; danh sách collection ở `TENANT_COLLECTIONS` (`src/tenants/tenant-collections.ts`). Chỉ module tầng dữ liệu được gọi `db.collection(...)` (test `tenant-source-scan` giữ danh sách); mọi truy vấn thêm `inTenant(tenant)`, mọi ghi thêm `tenantTag(tenant)`. Repository, token store, outbox, adapter nhận tenant bắt buộc khi dựng.
- Chỉ mục unique luôn dẫn đầu bằng `tenantId`. Collection mới thì thêm vào `TENANT_COLLECTIONS`, có `tenantId` và test cô lập.
- Resource/audience, client tĩnh, token exchange lấy từ tenant (`resourcesFor`, `tenantResourcePolicy`, `buildStaticClients(tenant, …)`); không thêm URL hay tên cố định của `hoandat.com` vào code chạy. Chuỗi hiển thị dùng `{brand}`/`{brandDomain}`; trang lấy tenant qua `requestTenant(req)`.
- Domain đi vào DNS, certbot, nginx luôn qua `normalizeTenantDomain`.
- Đọc tương thích (`ownsUntaggedData` của tenant chính) chỉ tồn tại tới cổng cuối phase 02; sau khi có tenant thứ hai chỉ sửa tiến.

## Quy ước code
- TypeScript strict, ESM (NodeNext, import tương đối có đuôi `.js`), không `any` (dùng `unknown` + type guard), không non-null assertion `!`, named exports, file kebab-case, ≤ 200 dòng.
- Không `console.log` ở runtime; dùng logger pino (`src/logger.ts`).
- Đường dẫn endpoint chỉ khai báo ở `OIDC_ROUTES` (`src/oidc/provider.ts`); rate limit đọc từ đó và so khớp sau `normalizeRoutePath` (router của provider không phân biệt hoa/thường, bỏ `/` cuối).
- Audience và scope theo resource chỉ khai báo ở `src/oidc/resources.ts`.
- Ký token (ADR 0005): ES256 cho mọi token và là mặc định của ID token; RS256 chỉ cho ID token của client khai nó. Khoá ký là khoá đầu tiên **của mỗi thuật toán** trong JWKS: lấy qua `primarySigningKey`/`rsaSigningKey` (`src/oidc/jwks.ts`), không bao giờ `keys[0]`. Discovery production phải có cả `ES256` và `RS256` (`seed-clients` kiểm).
