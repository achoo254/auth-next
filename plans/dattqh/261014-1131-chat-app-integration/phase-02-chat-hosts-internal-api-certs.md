---
phase: 2
title: "Host chat theo tenant, API nội bộ, chứng chỉ"
status: pending
priority: P1
effort: "L"
dependencies: [1]
---

# Phase 02: Host chat theo tenant, API nội bộ, chứng chỉ

## Goal

Backend chat (chạy chung `.65`) tra được tenant theo host `chat.<d>` qua API nội bộ bằng vai `chat`. Tenant bật chat thì có `chat.<d>` và `*.chat.<d>` với chứng chỉ hợp lệ. Tenant chưa bật chat không bị ảnh hưởng gì.

## Phạm vi

- **Bật chat theo tenant:**
  - Thêm trường `apps.chat.enabled` trên tenant, mặc định `false` với tenant sổ. Tenant chính bật sẵn từ env.
  - Owner bật/tắt ở `/admin`, có CSRF như các thao tác khác. Trang hiện các bản ghi DNS cần có trước khi bật: A của `chat.<d>` và `*.chat.<d>` trỏ thẳng IP `.65`, DNS-only vì wildcard hai cấp.
  - Bật hoặc tắt chat thì ghi audit `tenant.configured` và tăng `configVersion`.
- **Host:**
  - `appHostsFor` (`src/tenants/tenant.ts:50-58`) thêm `chat` và `chatWildcard`.
  - Mọi nơi dùng danh sách host (kiểm sở hữu, chứng chỉ, nginx) chỉ lấy host chat khi tenant đã bật chat.
- **Kiểm sở hữu:**
  - `src/tenants/ownership-check.ts:78-86` chỉ đòi bản ghi A của host chat khi chat đã bật.
  - Lúc bật, kiểm DNS ngay; sai thì từ chối bật, không đình chỉ tenant.
  - Sau khi bật, host chat sai DNS lâu dài chỉ tự tắt chat (kèm thông báo ở `/admin`), không đình chỉ cả tenant.
- **Nhãn cấm:** `APP_LABELS` (`src/tenants/tenant.ts:29-39`) thêm `chat`, nên `looksLikeAppHost` chặn nhận domain `chat.x` ở `claim-service.ts:82` và provisioner (`src/provisioner/provisioner-config.ts:78`).
- **API nội bộ:**
  - `InternalRole` và `ROLES` (`src/tenants/internal-auth.ts:5-11`) thêm `chat`; `requireRole` (`src/tenants/internal-api.ts:50`) nhận `["localman", "tunelo", "chat"]`.
  - Tra host (`src/tenants/internal-lookups.ts:22,25`) nhận nhãn đầu `chat` và nhãn thứ hai `chat` (cho `<x>.chat.<d>`).
  - Host chat của tenant chưa bật chat trả 404 như host lạ.
  - Response giữ nguyên trường; `webApps` có `chat` khi đã bật.
- **Chứng chỉ:** `src/tenants/internal-certificates.ts:41-48` và `src/provisioner/certbot-commands.ts` thêm `chat.<d>` (HTTP-01) và `*.chat.<d>` (DNS-01) khi tenant bật chat. `src/provisioner/nginx-names.ts:44-62` nhận biết host chat.
- **nginx** (`infra/nginx/`):
  - `tenants-http.conf:10-14` map chứng chỉ cho `chat.` và `*.chat.`; `tenants-acme.conf:9` thêm `chat` vào regex port 80.
  - Server block proxy của chat thuộc repo `chat-next` (đúng quy ước "mỗi app ship block regex của mình", ADR 0006), không nằm ở đây.
- **Env production:** `INTERNAL_API_CREDENTIALS` thêm vai `chat` (secret ≥ 32 ký tự, sinh trên server).
- **Tenant thử cho dev:** script chỉ chạy khi `NODE_ENV` khác `production`, tạo một tenant sổ đã `active` (domain thử, bật chat) mà không qua `/claim` và DNS. Docker Compose dev của app chat cần nó để test chọn tenant theo Host với hai tenant.

## Verification

- Test:
  - tenant chưa bật chat: kiểm sở hữu không đòi DNS chat, lookup `chat.<d>` trả 404, không có yêu cầu chứng chỉ chat;
  - bật chat khi DNS sai bị từ chối và tenant vẫn `active`;
  - bật chat khi DNS đúng thì có yêu cầu chứng chỉ hai host và lookup trả tenant;
  - vai `chat` gọi được API nội bộ, vai `provisioner` không gọi được lookup, sai credentials trả 401;
  - nhận domain `chat.example.com` bị từ chối ở IdP và provisioner;
  - test cô lập: host chat của tenant A không bao giờ trả tenant B.
- `nginx -t` với conf mới trên máy dev (container nginx) trước khi lên `.65`.

## Risks

- Đổi kiểm sở hữu là vùng có thể đình chỉ tenant thật. Viết test cho tenant `inetdev.io.vn` hiện có (chưa bật chat) trước khi sửa.
- Thêm trường vào document tenant: chỉ thêm tiến, mặc định `false`, không cần migration dữ liệu.
