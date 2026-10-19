---
phase: 7
title: "Nghiệm thu đầu-cuối và tài liệu"
status: done
priority: P1
effort: "M"
dependencies: [3, 4, 5, 6]
---

# Phase 07: Nghiệm thu đầu-cuối và tài liệu

## Goal

Chứng minh đủ 9 tiêu chí nghiệm thu của hợp đồng bằng một domain thử thật trên production và cập nhật tài liệu chính thức của cả hai repo. (Đọc tương thích đã được gỡ ở từng app trước khi có tenant thứ hai, RT 4; phase này chỉ kiểm lại.)

## Phạm vi

- Kiểm lại (đếm) không còn bản ghi thiếu `tenantId` ở cả ba app và không còn chỉ mục unique cũ.
- Domain thử (user cung cấp): nhận qua `auth.hoandat.com/claim` bằng TXT, khai OAuth và token Cloudflare, provisioner cấp chứng chỉ, đăng nhập ở `auth.<d>`, tạo project và mock ở `localman.<d>`, `tunelo login --server` và mở tunnel ở `tunnel.<d>`, Localman cùng tenant thấy tunnel.
- Cô lập trên prod giữa domain thử và `hoandat.com`: token, cookie, dữ liệu, tunnel cùng subdomain, cache.
- Tenant `hoandat.com`: Config OP 38/38, Localman/Tunelo đăng nhập, refresh, token exchange, back-channel logout, audit, CLI cũ.
- Thử trần: vượt `TENANT_MAX_ACTIVE` thì nhận domain bị từ chối, tenant hiện có không ảnh hưởng.
- Thử kiểm lại sở hữu: đổi TXT của domain thử → tenant chuyển `suspended`.
- Grep "hoandat" trong code chạy của hai repo chỉ còn ở cấu hình tenant `hoandat.com` và client id cố định `hoandat-account` (ngoại lệ đã ghi).
- Docs: ADR multi-tenant (repo `hoandat-auth`), `docs/deployment-guide.md`, `docs/integration-guide.md`, `README.md`, `CLAUDE.md` của hai repo, hai skill vận hành prod; tài liệu cho chủ domain (bắt đầu ở `auth.hoandat.com/claim`, TXT, A record DNS-only cho wildcard, OAuth, token Cloudflare).

## Verification

- Bảng nghiệm thu 1–9 của hợp đồng, mỗi dòng có bằng chứng (lệnh, kết quả, ảnh chụp nếu là giao diện).
- Restart của ba app trước và 15 phút sau mỗi lần deploy.

## Kết quả (13/10/2026)

Domain thử: `inetdev.io.vn` (tenant `ten_u_bsz0wGr2TR7Huk`, owner là danh tính Google của chủ máy, đăng nhập bằng GitHub OAuth App riêng). Mọi bước chạy trên production .65.

| # | Tiêu chí | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | Nhận domain, chứng chỉ, OAuth, đăng nhập | Đạt | `/claim` → TXT + 5 bản ghi A → `claimed`; provisioner cấp `<d>` (HTTP-01) và `wildcard.<d>` (DNS-01, token Cloudflare giới hạn zone) ở staging rồi production (Let's Encrypt YE1/YE2, `certbot renew --dry-run` đạt); GitHub khai ở `/admin` → `active`; chủ đăng nhập GitHub ở `auth.inetdev.io.vn/account` |
| 2 | Host chưa nhận, TXT sai | Đạt | Host tenant chưa có: bắt tay TLS thất bại; TXT sai 3 lần liền → `suspended` (`ownership`), IdP/Localman/Tunelo trả 421; TXT đúng lại → tự `active`, ba app 200 |
| 3 | Cô lập | Đạt | Token của `auth.inetdev.io.vn`: `tunnel.inetdev.io.vn/api/tunnels` 200, `tunnel.hoandat.com` 401; cookie đều `__Host-`/`__Secure-`, không `Domain`; dữ liệu ba DB tách theo `tenantId` (Localman: user, phiên, audit riêng của tenant); cùng tên tunnel `inetdev-accept` trên hoandat.com 502; test tự động cho từng loại ở hai repo |
| 4 | Localman của tenant | Đạt | Đăng nhập `localman.inetdev.io.vn` qua `auth.inetdev.io.vn`; project "Demo shop" tạo trên tenant, mock `<secret>.localman.inetdev.io.vn` được ghi nhận, cùng secret trên `localman.hoandat.com` thì không; MCP: client đăng ký động ở `auth.inetdev.io.vn` (chỉ scope MCP, không `openid`), PKCE + `resource`, token `aud=https://localman.inetdev.io.vn/mcp`, `initialize`/`tools/list` (74 công cụ)/`list_projects` (thấy "Demo shop") 200, cùng token trên `localman.hoandat.com/mcp` 401; client thử đã xoá |
| 5 | Tunelo của tenant | Đạt, trừ một vế | CLI 1.8.0 `login --server https://tunnel.inetdev.io.vn` duyệt ở `auth.inetdev.io.vn`, tunnel `https://inetdev-accept.tunnel.inetdev.io.vn` 200 qua Internet; console tenant thấy tunnel. Vế "Localman của cùng tenant thấy tunnel" không áp dụng: Localman không có danh sách tunnel theo tài khoản (`tunnelTokens` dựng mà không dùng, từ `3681d8e`) |
| 6 | Tên tenant, không còn "hoandat" cứng | Đạt | Grep hai repo: chỉ còn mặc định của tenant chính, client id `hoandat-account`, tiền tố TXT/audit URI, tên dịch vụ; sửa mô tả `users.getMe` (`localman-next` `2ff05d2`); sơ đồ `/apps` vừa tên tenant (`72ebde6`) |
| 7 | Tenant hoandat.com không đổi | Đạt | Cùng issuer và `kid`; `/token` (refresh, token exchange) 200, audit giao hết (39 chính + 9 tenant); Config OP lại PASSED 38/38 (plan `UYPbPU1ahTveZ`); CLI 1.7.0 trên lab chạy tới khi nâng 1.9.0. Back-channel logout chạy thật trên tenant lúc 18:05 (đăng xuất ở `auth.inetdev.io.vn` → Localman nhận `/auth/backchannel-logout` 200, phiên tenant về 0) |
| 8 | Vượt trần | Đạt | `TENANT_MAX_ACTIVE=1` tạm thời: nhận `localman-cap-test.com` bị từ chối "Máy chủ chưa nhận thêm domain lúc này", `inetdev.io.vn` vẫn hoạt động; đã gỡ giới hạn |
| 9 | Cổng kiểm | Đạt | `hoandat-auth` ở `cc1529c`: lint 0, typecheck 0, 495/495, e2e 10/10, tokens sạch; `localman-next`: lint 0, typecheck 0, 4730/4730, mcp 0, e2e 40/40 |

Basic OP (OpenID, bản IdP thử qua Tunelo, plan `roxcEuJzulAxt`, 35 module): 22 PASSED, 3 WARNING (thiếu claim profile/`name` của tài khoản thử, không trả `acr`), 4 SKIPPED (address, phone, request object), 4 REVIEW (ảnh đã tải; trang lỗi `redirect_uri` đúng; hai test đăng nhập lại không có trang để chụp vì harness tự đăng nhập), 2 FAILED do chính sách/cấu hình: `oidcc-refresh-token` (`invalid_scope`: client web không có `offline_access`, cố ý) và `oidcc-server-client-secret-post` (plan không có client `client_secret_post`). Harness cho PKCE không bắt buộc (prod bắt buộc, chặt hơn OIDC Core) và bỏ grant token exchange (`395edb6`).

Lỗi tìm ra trong lúc nghiệm thu, đã sửa và deploy: bản ghi DNS trên `/claim` khó copy (`a5ff0ea`), token Cloudflare của tài khoản bị từ chối oan (`e3bb4a4`), CLI tự chuyển server khỏi `tunnel.inetdev.io.vn` (`e7f3280`, CLI 1.8.0), CSS cũ bị cache sau deploy (`cc1529c`), tên tenant tràn sơ đồ `/apps` (`72ebde6`).

Còn treo: danh sách tunnel trong Localman (tiêu chí 5) thuộc lộ trình Localman, không thuộc plan này.

Phát hiện khi kiểm back-channel logout: harness conformance giữ địa chỉ back-channel logout thật nên đã gửi 11 logout token tới Localman prod (17:42–17:43), prod từ chối hết (`ERR_JWKS_NO_MATCHING_KEY`); harness đã bỏ các địa chỉ đó (`hoandat-auth`, commit sửa harness ngày 13/10).
