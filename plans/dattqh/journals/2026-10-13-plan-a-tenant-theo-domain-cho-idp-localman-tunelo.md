---
title: "Plan đa tenant theo domain cho IdP, Localman, Tunelo"
date: 2026-10-13
summary: "Lập plan 7 phase biến hoandat-auth, Localman, Tunelo thành dịch vụ đa tenant theo domain; red-team 4 góc nhìn, áp 15 phát hiện."
---

# Plan đa tenant theo domain cho IdP, Localman, Tunelo

## What happened
- Brainstorm với user và Jev: chủ domain tự nhận bằng TXT, tài khoản cô lập theo domain, Let's Encrypt HTTP-01 + DNS-01 bằng token Cloudflare của tenant, hostname theo quy ước `auth.`/`localman.`/`tunnel.`, IdP giữ sổ tenant, chạy trên .65 (user chọn khác lời khuyên máy riêng của Jev).
- Plan `plans/dattqh/261013-0043-multi-tenant-by-domain/`: 7 phase (5×L, 1×XL, 1×M), phase 01 chi tiết đến tệp, các phase sau scout lại khi làm.
- Red-team 4 reviewer ra 41 phát hiện, gộp còn 15 (8 Critical, 7 High), áp cả 15, bác 1 (thu hẹp `tenantId`).

## Decision
- Lỗ lớn nhất red-team bắt được: resource/audience và token exchange cứng theo hoandat; ghi adapter theo `tenantId` làm vỡ phiên khi chưa backfill; 3 chỉ mục unique toàn cục bị sót; chiếm owner qua đua log chứng chỉ; JWKS của tenant qua DNS công khai; trạng thái Tunelo khoá theo subdomain trần; Localman có 43 model chứ không phải 17.
- User chốt sau red-team: nhận domain bắt đầu qua HTTPS ở `auth.hoandat.com/claim` gắn danh tính; gỡ `tunnel.inetdev.io.vn` trước phase Tunelo; sau khi có tenant thứ hai chỉ sửa tiến.
- Hợp đồng: `plans/dattqh/reports/brainstorm-261013-0727-multi-tenant-auth-by-domain.md`.

## Next steps
- Chờ user duyệt rồi `/ak:cook` phase 01 (lõi tenant IdP, hoandat là tenant duy nhất, không đổi hành vi prod).
- Còn mở: giá trị trần `TENANT_MAX_ACTIVE` (đo RSS ở phase 02), cơ chế chuyển owner sang `/admin` của tenant (phase 03).

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
