# CLAUDE.md

`hoandat-auth`: IdP OpenID Connect tại `auth.hoandat.com` (oidc-provider v9 + Express 5 + MongoDB, database `auth`). Plan nằm ở repo `localman-next`: `plans/dattqh/261008-1325-central-auth-idp/`. Quyết định kiến trúc: `docs/decisions/0001-own-oidc-idp.md`, `docs/decisions/0002-accounts-and-login-pages.md`.

Commands: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm check:tokens`, `pnpm generate-key`. Trước khi báo xong phải sạch `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens`. Máy dùng chung: vitest đã giới hạn 2 worker trong `vitest.config.ts`, Playwright 1 worker; không chạy hai bộ test cùng lúc. `pnpm test -- <args>` không chuyển tham số, viết `pnpm test <args>`.

## Quy tắc bảo mật
- **Không log secret hay token**: không log client secret, cookie, header `authorization`, access/refresh/ID token, authorization code, device code, mật khẩu, khoá ký. Logger pino đã redact các trường này; đừng thêm log làm lộ chúng.
- **Không commit `secrets/` hay `.env`**. Khoá ký chỉ nằm trong file secret mount read-only.
- **Không gửi email**: không thêm nodemailer, SMTP hay dịch vụ mail. `grep -ri "nodemailer\|smtp" src` phải rỗng.
- Không có đường auto-login nào ngoài test: `src/__tests__/helpers/auto-interactions.ts` và upstream giả `src/__tests__/helpers/fake-upstreams.ts` chỉ được import từ test và `e2e/`.
- Không log mật khẩu, mã khôi phục, mã liên kết Telegram, token reset, state/code của Google/GitHub. Token reset nằm trong path `/reset/<token>`; error handler đã che path này.
- Không bao giờ để lộ một email/username có tồn tại không: đăng nhập sai và tài khoản không có phải cùng thông báo, cùng thời gian (luôn chạy argon2, xem `checkPassword`); yêu cầu reset qua Telegram luôn trả cùng một câu.
- Mọi lượt thử bí mật (mật khẩu, mã khôi phục, reset qua Telegram) phải giữ chỗ qua `LoginThrottle.reserve` *trước* khi kiểm, với subject từ `throttleSubject`. Không thêm đường kiểm mật khẩu nào bỏ qua bước này.
- Thao tác nhạy cảm ở `/account` dùng `portalRoute(..., { csrf: true, recentLogin: true })`. Đổi/đặt lại mật khẩu đi qua `afterPasswordChange` (huỷ token một lần, thu hồi phiên, grant, bật rà soát bảo mật sau reset, báo Telegram); mật khẩu chỉ ghi qua `setPassword` (đổi thế hệ thông tin đăng nhập, làm cookie thiết bị cũ mất hiệu lực).
- Token một lần gắn với tài khoản chỉ được cấp/đọc qua `services.accountTokens` (kiểu `AccountTokenKind`); nó tự kiểm `securityVersion` và kênh. Mọi thay đổi bảo mật mới trên tài khoản phải `$inc: { securityVersion: 1 }` trong cùng câu cập nhật ở tầng repository. Thao tác ghi được phép bởi token thì truyền `version` mà `peek`/`take` trả về xuống phương thức repository (ghi có điều kiện, nhận `GuardedWrite`; `applied: false` thì coi như token hết hạn). Luồng tự làm tăng version mà cần dùng tiếp token của mình thì gọi `renew` với version mà chính lệnh ghi đó trả về.
- Mọi lần hoàn tất đăng nhập trong interaction gọi `completeLogin` (không gọi thẳng `finishLogin`), để tài khoản đang chờ rà soát bảo mật dừng ở trang rà soát.
- `email_verified` chỉ `true` khi Google/GitHub xác minh.
- Đổi cấu hình provider thì đọc docs `oidc-provider` đúng major đang dùng trước; API đổi theo major.

## Hợp đồng với client
- Refresh token xoay vòng và dùng một lần; client phải khoá khi refresh (Tunelo CLI: file lock) vì hai refresh song song thì một cái nhận `invalid_grant`. Phiên trượt: mỗi refresh gia hạn grant thêm 30 ngày, trần cứng 90 ngày từ lúc đăng nhập (`src/oidc/sliding-grants.ts`).
- Chi tiết cho app tích hợp nằm ở README, mục "Lưu ý cho client".

## Trang render phía server
- Mọi HTML đi qua template `html` trong `src/ui/html.ts` (tự escape); `trustedHtml` chỉ cho markup do `oidc-provider` sinh ra. Không nối chuỗi HTML thô.
- Không có inline script hay inline style (CSP `script-src 'self'`, `style-src 'self'`). Màu chỉ lấy từ biến trong `static/css/tokens.css` (bản sao của Localman, sửa bằng cách chép lại cả file); `pnpm check:tokens` chặn mã màu ở chỗ khác.
- Mọi form POST có CSRF qua `services.csrf` với đúng phạm vi: `csrfScope(uid)` cho interaction, `portalCsrfScope` cho `/account`, `reset:<token>` cho trang reset. Body form chỉ parse trong router của trang (`parseForm`), không bao giờ trước `oidc-provider`.
- Route của interaction phải nằm dưới `/interaction/:uid/...` vì cookie interaction gắn với path đó; luôn đọc interaction qua `loadInteraction` (kiểm cookie và uid).
- Google/GitHub chỉ đi qua interface `UpstreamClient` (`src/accounts/upstream-client.ts`), cài bằng `openid-client` trong `upstream-google.ts`, `upstream-github.ts`; luôn PKCE + state, Google thêm nonce. Test thay Google/GitHub bằng fetch giả, không gọi mạng thật.

## Quy ước code
- TypeScript strict, ESM (NodeNext, import tương đối có đuôi `.js`), không `any` (dùng `unknown` + type guard), không non-null assertion `!`, named exports, file kebab-case, ≤ 200 dòng.
- Không `console.log` ở runtime; dùng logger pino (`src/logger.ts`).
- Đường dẫn endpoint chỉ khai báo ở `OIDC_ROUTES` (`src/oidc/provider.ts`); rate limit đọc từ đó và so khớp sau `normalizeRoutePath` (router của provider không phân biệt hoa/thường, bỏ `/` cuối).
- Audience và scope theo resource chỉ khai báo ở `src/oidc/resources.ts`.
