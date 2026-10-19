# Deploy IdP 84c169d: /account liệt kê từng máy của app native (2026-10-19)

Phase 04 của plan `261014-1131-chat-app-integration`. User chọn deploy riêng `84c169d` (Jev 0,58), không kèm `8cd497f` (Sign in with Apple của phiên khác).

## Đã chạy

| Bước | Kết quả |
|---|---|
| CI `84c169d` | xanh (run 39209828690, job `checks`) |
| Backup ngay trước deploy | `auth-20261019-143353` |
| Build | từ `git archive 84c169d` trong thư mục tạm; bản build có `grantsPerDevice`, không có code Apple |
| `infra/deploy.sh` | `healthz ok`; pm2 `hoandat-auth` online, restart 55 → 56 (reload của deploy) |
| Log lỗi sau deploy | trống |

Khi build từ thư mục tạm, `pnpm build` dừng ở bước kiểm dependency vì `node_modules` là symlink. Đã chạy lại `deploy.sh` với `pnpm --config.verify-deps-before-run=false`, chỉ trong lệnh đó; `node_modules` của repo không bị đổi.

## Kiểm sau deploy (từ ngoài)

- `/healthz`, discovery, `/jwks`, `/apps` của `auth.hoandat.com` trả 200; discovery ký ID token bằng `ES256`, `RS256`.
- `chat-web`, `chat-mobile` (header `Location` là `com.hoandat.chat:/auth/callback`), `chat-desktop`, `localman-web`, `tunelo-web` đều chuyển lỗi PKCE về đúng redirect của mình.
- `chat.hoandat.com` và `localman.hoandat.com` trả 200.
- `.env` prod không có biến `APPLE_*` (chưa bật Apple).

## Chưa kiểm được trong phiên

- Đăng nhập thật ở Localman và Chat cần tài khoản Google/GitHub của người dùng.
- `/account` với hai máy Chat thật: test `chat-clients-flow.test.ts` đã kiểm trên CI, chưa kiểm trên prod.
- Số restart của `hoandat-auth` 15 phút sau deploy.

## Rollback

Deploy lại `de05b95` theo `docs/deployment-guide.md` §Rollback. Không có thay đổi dữ liệu: các grant mới tạo thêm document `grant_meta`, mà code cũ vẫn đọc collection này.
