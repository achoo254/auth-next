---
phase: 5
title: "Localman theo tenant"
status: done
priority: P1
effort: "XL"
dependencies: [2]
---

# Phase 05: Localman theo tenant (repo `localman-next`)

> Chế độ deep, bắt buộc kiểm kê trước khi code (RT 14): `apps/api` có **43** lời gọi tạo model (không tính test), không phải 17. Lập bảng mọi collection kèm khoá tra cứu (theo `sub`, theo token/secret toàn cục, theo hostname), quyết định gắn `tenantId` cho từng cái, rồi tách phase con theo module.

## Goal

Localman phục vụ mọi tenant: `localman.<domain>` và `*.localman.<domain>` chọn tenant theo Host, đăng nhập bằng `auth.<domain>`, dữ liệu cô lập theo `tenantId`; tenant `hoandat.com` không đổi hành vi và không phụ thuộc API của IdP lúc chạy.

## Phạm vi

- **Tra tenant (RT 13):** tenant `hoandat.com` dựng tĩnh từ env, không gọi API. Tenant khác tra qua API nội bộ loopback của IdP, cache dùng bản cũ khi IdP lỗi (stale-while-error), chỉ cache âm khi IdP trả 404 thật.
- **OIDC client theo tenant:** issuer `https://auth.<domain>`; JWKS và metadata lấy qua API nội bộ, không phân giải `auth.<domain>` qua DNS công khai (RT 6); secret client = HMAC theo tenant (phase 02).
- **Dữ liệu:** `tenantId` trên toàn bộ collection theo bảng kiểm kê + chỉ mục ghép (tạo bằng script **trước** deploy vì `initModels()` build chỉ mục trước khi listen và `switch-release.sh` chỉ đợi 30 giây, RT 14) + backfill + gỡ đọc tương thích ngay khi backfill của app báo 0 (trước khi tenant thứ hai dùng Localman).
- **Cấu hình đơn domain (RT 14):** SSRF guard chỉ cho đi tới địa chỉ .65 khi host thuộc mock/tunnel của **đúng** tenant đang gọi; CORS theo tenant; `auth-module`, `TUNNEL_RESOURCE` theo tenant; worker nền (outbound jobs, thông báo) mang `tenantId`; `ownerSubs`, cảnh báo và Telegram của owner thành cấu hình theo tenant; lệnh vận hành có `--tenant`; quyết định cho Pro/trial (ghi rõ hành vi với tenant mới).
- **Mock và MCP:** `*.localman.<domain>` và `/m/<secret>` chỉ trả mock của đúng tenant; Protected Resource Metadata và audience `https://localman.<domain>/mcp` theo tenant.
- **Audit:** kiểm `iss` theo tenant; một bộ Basic credentials cho mọi tenant (phase 02).
- **Tuỳ chọn theo tenant:** Telegram, Turnstile, Web Push (VAPID sinh tự động); chưa khai thì tắt.
- **Web:** bỏ `VITE_IDP_ORIGIN` và chữ "hoandat" nướng lúc build; tên hiển thị và issuer lấy lúc chạy từ API; 7 thư mục i18n có "hoandat" đổi sang biến; CSP theo phase 04.
- **Token exchange** sang Tunelo đích `https://tunnel.<domain>` theo tenant (phối hợp phase 06).

## Verification

- Cổng kiểm `localman-next` sạch; test cô lập hai tenant cho từng collection trong bảng kiểm kê; test SSRF chéo tenant; e2e chạy với hai tenant giả.
- Tenant `hoandat.com`: e2e hiện có pass không sửa kỳ vọng; test "IdP ngừng → hoandat và tenant đã cache vẫn chạy".

## Risks

- Phạm vi lớn nhất của plan: tách phase con theo module sau kiểm kê; mỗi module có test cô lập riêng.

## Kết quả (13/10/2026)

Commit trên `main` của `localman-next` (chưa push, chưa deploy): `d3a080f` dữ liệu theo tenant, `cd39f37` tenant theo Host, `427448a` sửa review tầng dữ liệu, `78c51dd` đăng nhập theo tenant, `bfeabed` Telegram chỉ tenant chính, `e19e1b9` web theo domain, `0e54c9c` nginx tenant, `01d30c5` metadata MCP theo request, `5ac0860` sửa review định tuyến/đăng nhập/web/nginx. IdP: `7ae6161` (`GET /internal/tenants/:id`). Quyết định ghi ở `localman-next/docs/decisions/0003-tenant-scoped-data.md`.

- Dữ liệu: plugin mongoose trên cả 41 model, `AsyncLocalStorage`, mọi index (trừ TTL và hai index hàng đợi) dẫn đầu bằng `tenantId`; dữ liệu cũ gắn `primary` bằng `create-tenant-indexes.mjs` trước switch và lúc khởi động; index cũ chỉ gỡ khi bật `IDP_INTERNAL_URL`.
- Lệch so với plan: e2e Playwright vẫn chỉ chạy tenant chính; cô lập hai tenant được kiểm bằng test tích hợp qua socket thật (đăng nhập qua IdP của tenant, dashboard/mock cùng secret, SSRF chéo tenant, audit theo `iss`, `/healthz` loopback). `switch-release.sh` chưa có smoke test host tenant. Cấu hình nginx chưa chạy được `nginx -t` (máy dev không có nginx/docker); trên server `switch-release.sh` chạy `nginx -t` và khôi phục khi lỗi.
- Web Push dùng một cặp VAPID cho mọi tenant; Telegram và Turnstile tắt cho tenant khác (form công khai cần đăng nhập).
- Review: `plans/dattqh/reports/review-261013-localman-tenant-data-layer.md`, `review-261013-localman-tenant-routing-auth-web.md`; mọi mục High/Medium đã sửa.
