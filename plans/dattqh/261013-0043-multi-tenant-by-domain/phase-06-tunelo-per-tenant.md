---
phase: 6
title: "Tunelo và CLI theo tenant"
status: done
priority: P1
effort: "L"
dependencies: [2, 5]
---

# Phase 06: Tunelo và CLI theo tenant (repo `localman-next`)

> Chế độ deep: scout `apps/tunelo-server` (5 collection, `tunnel-manager.ts`, `cache/response-cache.ts`, `tcp-port-manager.ts`, `config/tunnel-domains.ts`, `auth/idp-token-verifier.ts`, `web/`), `packages/tunelo-cli` (`credentials.ts`, `idp-client.ts`, `server-url.ts`, `config.ts`, `portal/api/client.ts`) và `infra/tunelo/` trước khi làm.

## Điều kiện trước (RT 9, user chọn 2026-10-13)

`tunnel.inetdev.io.vn` được **gỡ hẳn trước phase này**: theo dõi log `tunnel_old_domain` tới khi trống, báo người còn dùng (OneMail dev, onedash-dev) chuyển sang `tunnel.hoandat.com`, gỡ khỏi `TUNNEL_DOMAINS`, nginx và allowlist của CLI. Không có khái niệm alias. `inetdev.io.vn` nằm trong danh sách domain cấm nhận (phase 03).

## Goal

Tunelo phục vụ mọi tenant: `tunnel.<domain>` và `*.tunnel.<domain>` chọn tenant theo Host, xác minh token của `auth.<domain>`, mọi trạng thái cô lập theo tenant; CLI đăng nhập và mở tunnel tới server của tenant mà không bao giờ gửi token sang server khác; CLI đã cài vẫn chạy với `hoandat.com`.

## Phạm vi

- **Tra tenant (RT 13):** tenant `hoandat.com` dựng tĩnh từ env; tenant khác qua API nội bộ loopback, stale-while-error; JWKS lấy qua API nội bộ, issuer suy từ Host rồi mới so `iss` (RT 6).
- **Trạng thái theo tenant (RT 8):** khoá `(tenantId, subdomain)` cho map tunnel trong bộ nhớ, cache phản hồi Valkey, lệnh purge, grace timer, request mồ côi; `buildTunnelUrl(tenant, sub)` theo domain của tenant; quota cổng TCP theo tenant và URL TCP theo domain của tenant (TCP không tách theo Host: cổng là định danh, ghi rõ trong tài liệu).
- **Dữ liệu:** `tenantId` trên 5 collection + backfill + gỡ đọc tương thích khi backfill báo 0.
- **Token exchange:** Localman của tenant đổi token `aud=https://tunnel.<domain>`; Tunelo từ chối audience của tenant khác.
- **Web:** branding theo tenant (4 tệp `src/web` + i18n có "hoandat").
- **CLI (RT 10):** giữ một `server` và một `session`; `tunelo login --server https://tunnel.<d>` thay cả hai. Issuer và resource suy **cứng** theo quy ước từ host server (`tunnel.<d>` → `https://auth.<d>`, `https://tunnel.<d>`), không lấy từ phản hồi của server. Thay allowlist `ACCOUNT_SERVER_HOSTS` bằng quy tắc: token chỉ gửi tới server có cùng `<d>` với issuer của phiên. Gom hai `DEFAULT_SERVER_URL` về một chỗ. Phát hành bản CLI mới qua tag `tunelo-vX.Y.Z` khi user yêu cầu.

## Verification

- Cổng kiểm `localman-next` sạch; test cô lập hai tenant: cùng subdomain ở hai tenant, cache chéo tenant, purge, quota TCP, thiết bị, link, token.
- Test CLI: token của `hoandat.com` không bao giờ rời CLI tới host khác `tunnel.hoandat.com`; CLI bản cũ (không có `--server`) vẫn đăng nhập và mở tunnel với `hoandat.com`.

## Risks

- Phát hành CLI là thao tác công khai: chỉ khi user yêu cầu.

## Kết quả (13/10/2026)

Commit trên `main` của `localman-next` (chưa push): `d935942` gỡ `tunnel.inetdev.io.vn` (kể cả `mail.tunnel.inetdev.io.vn`), `412291d` gói `@localman/tenancy` dùng chung, `a2bfca0` Tunelo theo tenant, `40571ed` + `3005b13` + `793f9aa` sửa review, `ef69d8b` Tunelo chỉ nghe loopback sau nginx (cổng 3001 trước đó trả lời từ Internet). Ngoài ra `cloud-panel-application` `725e4bcbd`: lab dev chuyển sang `onedash-dev.tunnel.hoandat.com`.

- Trạng thái theo tenant: tunnel, cache Valkey, purge, cổng TCP trong danh sách, key, link, usage, phiên console; token của tenant xác minh với `https://auth.<d>`, audience `https://tunnel.<d>`, JWKS qua API nội bộ.
- CLI: `tunelo login --server https://tunnel.<d>`; token chỉ gửi tới server cùng domain với issuer của phiên; phiên cũ của hoandat vẫn chạy. Đăng nhập lỗi không làm mất phiên đang có.
- Lệch so với plan: quota cổng TCP vẫn chung mọi tenant (chưa có số liệu tenant thật); CLI chưa phát hành (bản `--server` cần tag `tunelo-vX.Y.Z`, chờ user).
- Kiểm: lint 0, typecheck 0, 4725/4725 test (656 file), mcp 0, e2e 39/39; Tunelo server 215/215, CLI 48/48, tunelo-e2e 10/10.
- Review: `plans/dattqh/reports/review-261013-tunelo-tenancy.md` (H1, M1–M5 đã sửa).
