---
phase: 2
title: "IdP: runtime đa tenant, sổ tenant, secret, trần"
status: done
priority: P1
effort: "L"
dependencies: [1]
---

# Phase 02: IdP — runtime đa tenant, sổ tenant, secret, trần

> Chế độ deep: scout lại `src/app.ts`, `src/services.ts`, `src/server.ts`, `src/http/security.ts`, `src/audit/*`, `src/accounts/upstream-*.ts`, `src/telegram/*` trước khi làm; chi tiết tệp chốt sau scout.

## Goal

Một process IdP phục vụ nhiều tenant an toàn: chọn tenant theo Host, mỗi tenant hoạt động có `TenantRuntime` riêng, sổ tenant và secret mã hoá trong Mongo, API nội bộ không lộ ra Internet, và cuối phase không còn đường đọc tương thích nào trước khi tenant thứ hai được tạo.

## Phạm vi

- **Sổ tenant:** collection `tenants` (domain đã chuẩn hoá, displayName, status `pending_claim|claimed|active|suspended`, owner (danh tính upstream), thời điểm, lần kiểm sở hữu gần nhất).
- **Secret (RT 7):** `tenant_secrets` mã hoá AES-256-GCM, AAD gồm `tenantId` và loại secret, có `kid` xoay vòng. Tách khoá theo lớp: `TENANT_SECRETS_KEY` của IdP cho OAuth secret, bot Telegram, khoá ký của tenant; token DNS Cloudflare được **niêm phong bằng public key của provisioner** (IdP không giải mã được). Không bao giờ in/log. Runbook backup và xoay khoá trong `docs/deployment-guide.md`. ADR ngoại lệ cho "khoá ký chỉ trong file" (tenant cũ vẫn dùng file).
- **Client:** `buildStaticClients(tenantUrls)` lúc dựng Provider, không lưu metadata client (RT 1). Secret của `localman-web`/`tunelo-web` cho tenant mới = HMAC(`APP_CLIENT_SECRET_KEY`, tenantId), Localman/Tunelo tính được cùng giá trị; tenant cũ giữ env. Không có API trả secret, không có nút xoay cho owner (RT 7).
- **Runtime (RT 13):** một trần duy nhất `TENANT_MAX_ACTIVE`; runtime dựng lười, single-flight theo tenant, không loại khỏi cache, tenant cũ ghim sẵn lúc khởi động; có `dispose()` cho tenant bị đình chỉ. Rate limit dùng **một store toàn process** ở dispatcher ngoài cùng, khoá `(tenantId, IP)`. Negative cache có TTL cho Host lạ.
- **Chọn tenant:** dispatcher Express ngoài cùng thay `requireKnownHost`; Host chuẩn hoá bằng `normalizeTenantDomain`; Host lạ → 404.
- **API nội bộ (RT 7):** listener riêng trên loopback (cổng riêng hoặc unix socket), không đi qua nginx; nginx của mọi host thêm `location /internal { return 404; }`. Xác thực bằng Basic credentials theo từng app, so sánh constant-time (dùng lại mẫu `hasValidBasicCredentials`). Endpoint: tra tenant theo Host (không secret), JWKS và metadata của tenant cho Localman/Tunelo (RT 6), hàng đợi chứng chỉ cho provisioner.
- **Audit (RT 7):** một dispatcher duyệt outbox chung, URL theo quy ước `https://localman.<domain>/internal/audit-events`, signer lấy khoá từ kho khoá của tenant (độc lập với runtime), một bộ Basic credentials của Localman cho mọi tenant (phân biệt bằng `iss`); tenant cũ giữ `AUDIT_EVENTS_URL`.
- **Kiểm lại sở hữu (RT 6):** job định kỳ kiểm lại TXT và A record của tenant; sai liên tục thì `suspended` và báo owner.
- **Cổng cuối phase (RT 4):** chạy backfill lần cuối, đếm 0 bản ghi thiếu `tenantId` ở mọi collection, gỡ đọc/ghi tương thích, gỡ 5 chỉ mục unique cũ. Chỉ sau cổng này mới được tạo tenant thứ hai. Từ đây chỉ sửa tiến (ADR 0006).
- Test hai tenant đầu-cuối: discovery/JWKS khác nhau, token của A bị B từ chối, rate limit không reset khi chạm nhiều tenant, API nội bộ không truy cập được qua nginx.

## Verification

- Cổng kiểm `hoandat-auth` sạch; test hai tenant pass; tenant cũ không đổi (snapshot discovery, `kid`, cookie).
- Đo RSS khi dựng song song `TENANT_MAX_ACTIVE` runtime; ghi số đo vào phase để chốt giá trị mặc định.

## Risks

- Lộ một bộ Basic credentials của app: chỉ đến được từ loopback, không có secret trả về qua API.
- Mất `TENANT_SECRETS_KEY`: tenant mất khoá ký; runbook backup khoá bắt buộc trước khi tạo tenant thứ hai.

## Kết quả (2026-10-13)

- Commit `c2caa4d` (runtime, sổ tenant, secret, API nội bộ, audit, kiểm sở hữu) và `8db2238` (cổng cuối: gỡ đọc tương thích; khởi động tự gắn `tenantId` cho document cũ, gỡ chỉ mục toàn cục, không phục vụ nếu còn document chưa gắn).
- Đo RSS (máy dev, mongod tạm, `node --expose-gc`): primary 165 MB; thêm 10 runtime tenant +3 MB, 25 runtime +11 MB, 50 runtime +21 MB (khoảng 0,4 MB mỗi runtime rỗi). Chi phí thật nằm ở lưu lượng, không ở số runtime. Chốt `TENANT_MAX_ACTIVE` mặc định 20.
- Lệch so với mô tả: Host lạ vẫn trả `421` như trước (không đổi sang `404`); báo owner khi tenant bị đình chỉ để phase 03 (owner chưa có kênh liên lạc).
