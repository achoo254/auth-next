---
phase: 4
title: "Triển khai và nghiệm thu với app chat"
status: completed
priority: P1
effort: "M"
dependencies: [2, 3]
---

# Phase 04: Triển khai và nghiệm thu với app chat

## Goal

Đưa thay đổi lên production `.65` mà không làm gián đoạn `hoandat.com`, Localman, Tunelo, rồi nghiệm thu đầu-cuối với bản staging của app chat ở tenant chính và tenant `inetdev.io.vn`.

## Phạm vi

- **Trước deploy:**
  - Backup database `auth` (theo `docs/deployment-guide.md`).
  - Sinh `CHAT_WEB_CLIENT_SECRET` và khoá app `chat-web` trên server (`node --env-file=.env dist/app-client-key.mjs chat-web <file>`), thêm vai `chat` vào `INTERNAL_API_CREDENTIALS`. Mọi secret sinh trên server, mode 600, không đi qua máy dev hay log.
  - Chép khoá app và secret sang `.env` của app chat trên cùng server.
- **Deploy:** build, chạy `node dist/seed-clients.mjs` (chỉ đọc) và đối chiếu fingerprint ba client chat, restart pm2, kiểm `/healthz`, discovery, `/apps`.
- **DNS và chứng chỉ:**
  - Tạo A `chat.hoandat.com` (và block nginx cụ thể của chat, do repo `chat-next` ship).
  - Ở tenant `inetdev.io.vn`: owner thêm A `chat.` và `*.chat.` rồi bật chat ở `/admin`; provisioner cấp chứng chỉ (Let's Encrypt staging trước, production sau khi đúng).
- **Nghiệm thu** (cùng app chat ở Phase 2 của plan chat):
  - acceptance 1–7 của plan này;
  - Localman và Tunelo đăng nhập, refresh, token exchange như cũ;
  - snapshot tenant chính chỉ khác ở phần client chat.

## Verification

- Biên bản nghiệm thu lưu `plans/dattqh/reports/` của repo này: lệnh đã chạy, kết quả, không chứa secret.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens` sạch trên commit deploy.

## Rollback

- Tắt chat ở `/admin` của tenant sổ.
- Triển khai lại commit trước. Client chat biến khỏi discovery; Localman và Tunelo không đổi.
- Trường `apps.chat.enabled` còn lại trong document vô hại vì code cũ không đọc nó.

## Kết quả (2026-10-19)

Ba client chat chạy trên prod từ 15/10, `chat.inetdev.io.vn` nghiệm thu 16/10 (plan chat). Phần còn lại, `/account` liệt kê từng máy (`84c169d`), deploy 2026-10-19: [biên bản](../reports/deploy-261019-1430-chat-account-devices.md). Các bước về bật chat theo tenant và vai `chat` trên đây không còn áp dụng (xem `plan.md`, mục "Đối chiếu với code").
