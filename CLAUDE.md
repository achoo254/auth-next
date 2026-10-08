# CLAUDE.md

`hoandat-auth`: IdP OpenID Connect tại `auth.hoandat.com` (oidc-provider v9 + Express 5 + MongoDB, database `auth`). Plan nằm ở repo `localman-next`: `plans/dattqh/261008-1325-central-auth-idp/`. Quyết định kiến trúc: `docs/decisions/0001-own-oidc-idp.md`.

Commands: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm generate-key`. Trước khi báo xong phải sạch `pnpm lint && pnpm typecheck && pnpm test`. Máy dùng chung: chạy vitest với `--maxWorkers=2`.

## Quy tắc bảo mật
- **Không log secret hay token**: không log client secret, cookie, header `authorization`, access/refresh/ID token, authorization code, device code, mật khẩu, khoá ký. Logger pino đã redact các trường này; đừng thêm log làm lộ chúng.
- **Không commit `secrets/` hay `.env`**. Khoá ký chỉ nằm trong file secret mount read-only.
- **Không gửi email**: không thêm nodemailer, SMTP hay dịch vụ mail. `grep -ri "nodemailer\|smtp" src` phải rỗng.
- Không có đường auto-login nào ngoài test: `src/__tests__/helpers/auto-interactions.ts` chỉ được import từ test. Production dùng placeholder 501 cho tới khi có trang đăng nhập.
- `email_verified` chỉ `true` khi Google/GitHub xác minh.
- Đổi cấu hình provider thì đọc docs `oidc-provider` đúng major đang dùng trước; API đổi theo major.

## Hợp đồng với client
- Refresh token xoay vòng và dùng một lần; client phải khoá khi refresh (Tunelo CLI: file lock) vì hai refresh song song thì một cái nhận `invalid_grant`. Grant hết hạn cứng sau 30 ngày, CLI phải đăng nhập lại.
- Chi tiết cho app tích hợp nằm ở README, mục "Lưu ý cho client".

## Quy ước code
- TypeScript strict, ESM (NodeNext, import tương đối có đuôi `.js`), không `any` (dùng `unknown` + type guard), không non-null assertion `!`, named exports, file kebab-case, ≤ 200 dòng.
- Không `console.log` ở runtime; dùng logger pino (`src/logger.ts`).
- Đường dẫn endpoint chỉ khai báo ở `OIDC_ROUTES` (`src/oidc/provider.ts`); rate limit đọc từ đó và so khớp sau `normalizeRoutePath` (router của provider không phân biệt hoa/thường, bỏ `/` cuối).
- Audience và scope theo resource chỉ khai báo ở `src/oidc/resources.ts`.
