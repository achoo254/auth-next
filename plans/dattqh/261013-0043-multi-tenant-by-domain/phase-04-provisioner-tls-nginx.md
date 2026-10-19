---
phase: 4
title: "Provisioner TLS và nginx"
status: done
priority: P1
effort: "L"
dependencies: [2]
---

# Phase 04: Provisioner TLS và nginx

> Chế độ deep: scout cấu hình nginx/certbot thật trên .65 (chỉ đọc, `nginx -T`, `certbot certificates`) và `localman-next/infra/{localman,tunelo}/` trước khi làm. Mọi thay đổi nginx dùng chung phải báo user trước.

## Goal

Chứng chỉ của tenant được cấp và gia hạn tự động, an toàn với certbot và nginx dùng chung của .65; mỗi app phục vụ mọi tenant bằng **một** server block theo quy ước, không sinh conf theo tenant (RT 11).

## Phạm vi

- **Server block theo quy ước (RT 11):** mỗi app ship trong release của chính nó một block tenant: `server_name ~^auth\.(?<tenant>.+)$` (tương tự `localman.`, `*.localman.`, `tunnel.`, `*.tunnel.`), `ssl_certificate /etc/letsencrypt/live/$ssl_server_name/...` (hoặc đường dẫn theo `$tenant`), CSP của Localman render cùng hash của build và `form-action https://auth.$tenant`. Các directive cấp `http` (`log_format`, `limit_req_zone`, `map`) nằm trong một tệp chung khoá theo `$host`. Block cụ thể của `hoandat.com` giữ nguyên và thắng trước block regex.
- **Provisioner (Node, root, systemd timer):** chỉ xử lý "tenant mới cần chứng chỉ" và "gỡ tenant". Đọc hàng đợi qua API nội bộ loopback (phase 02). **Kiểm lại** domain bằng `normalizeTenantDomain` và danh sách cấm trước mọi thao tác (RT 12); chạy certbot bằng `execFile` với mảng tham số, không qua shell.
- **Cấp chứng chỉ:** HTTP-01 webroot cho `auth.`, `localman.`, `tunnel.`; DNS-01 `dns-cloudflare` cho `*.localman.`, `*.tunnel.` bằng tệp credentials theo tenant **bền vững** (mode 600, thư mục chỉ root đọc), mở niêm phong token bằng private key của provisioner (RT 7, RT 11).
- **Gia hạn:** để `certbot-renew.timer` của máy gia hạn (renewal conf trỏ tệp credentials bền vững, hook reload nginx). Provisioner không gia hạn (một bên duy nhất).
- **Tách khỏi hoandat (RT 11):** tài khoản ACME và `--config-dir` riêng cho tenant, backoff và lần thử cuối lưu trong sổ tenant, dùng Let's Encrypt staging khi thử; một tenant lỗi không đốt hạn mức của cert hoandat.
- **Trùng tên:** trước khi cấp, đọc `nginx -T` và từ chối khi hostname trùng `server_name` hiện có (RT 9).
- **Gỡ tenant:** gỡ khỏi hàng đợi → `certbot delete` → `nginx -t` → reload.
- Docs: `docs/deployment-guide.md` mục provisioner, cách tạm dừng, cách gỡ tenant, backup private key của provisioner.

## Verification

- Test đơn vị: chuẩn hoá và từ chối domain độc hại (ký tự `;`, khoảng trắng, xuống dòng, public suffix), không lộ token trong argv/log.
- Thử trên .65 với một domain thử ở Let's Encrypt staging (khi user cho phép), rồi production; `certbot renew --dry-run` pass cho cert tenant.

## Risks

- Block regex chiếm host của app khác: block cụ thể luôn thắng block regex trong nginx; kiểm bằng `nginx -T` và request thử tới mọi host đang phục vụ trước khi reload.

## Kết quả (2026-10-13)

- Commit `d56bcce`. Scout .65 (chỉ đọc, qua cổng Jev → `ak-devops`): CentOS Stream 9, nginx 1.20.1, certbot 4.2.0 (`dns-cloudflare`, `webroot`), `certbot-renew.timer` chỉ cho `/etc/letsencrypt`, không có block regex hay `default_server` khai rõ, MongoDB 7.0.28, RAM khả dụng ~2,4 GB.
- Mỗi tenant hai chứng chỉ (`<d>` HTTP-01, `wildcard.<d>` DNS-01) trong `/etc/letsencrypt-tenants`; nginx chọn theo SNI qua map, không reload; timer gia hạn riêng.
- Chưa làm (cần user cho phép, thao tác trên máy dùng chung): chạy `setup-provisioner.sh`, chép 3 tệp nginx, `nginx -t` + reload, thử domain ở staging, `certbot renew --dry-run`. `nginx -t` của 3 tệp mới chưa chạy được ở máy dev (không có nginx/Docker).
