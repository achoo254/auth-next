---
title: "Đưa app chat vào IdP: client, host theo tenant, API nội bộ"
description: "IdP nhận app chat (chat.hoandat.com, chat.<domain>) là app first-party thứ ba sau Localman và Tunelo: client web và native, host chat theo tenant, vai chat ở API nội bộ, hạn mức refresh cho backend chat."
status: superseded
superseded: 2026-10-24
priority: P1
effort: "L (4 phase: 2×L, 2×M)"
branch: "main"
tags: [feature, auth, infra, backend]
blockedBy: []
blocks: []
created: 2026-10-14
---

# Đưa app chat vào IdP

> **Superseded 24/10/2026:** hệ sinh thái về đơn tenant ([ADR 0013](../../../docs/decisions/0013-single-tenant.md)); client `chat-web`, `chat-mobile` vẫn còn, nhưng host chat theo tenant, secret `chat-web` suy từ khoá gốc và API nội bộ đã gỡ. Plan này chỉ còn là lịch sử.

> **Huỷ 20/10/2026: desktop = PWA.** Toàn hệ sinh thái không có app desktop native (quyết định của user, `docs/ecosystem-architecture.md` §3, §4 ở thư mục gốc `hoandat-app`). Client `chat-desktop` đã gỡ khỏi code (`src/oidc/chat-clients.ts`); máy tính dùng `chat-web` cài dạng PWA. Phần về `chat-desktop` bên dưới chỉ còn là lịch sử.

## Overview

App chat (repo `chat-next`) là sản phẩm tiếp theo trong hệ sinh thái hoandat, sau Localman và Tunelo. Nó đăng nhập chỉ qua IdP này, có tenant theo domain như hai app kia, và backend chạy chung server `<SERVER_65_IP>` với IdP. Plan này làm phần phía IdP để app chat dùng được.

Nguồn yêu cầu là plan của app chat: `chat-next/plans/dattqh/261013-0448-chat-platform-v1/plan.md` (mục "Hệ sinh thái hoandat" và "Thay đổi cần làm ở `hoandat-auth`"), ADR 0006 và 0010 trong Phase 1 của plan đó. Vị trí code cần sửa đã được scout ngày 2026-10-14 và ghi trong từng phase.

## Hợp đồng

**Outcome:**
- Người dùng đăng nhập app chat bằng tài khoản hoandat:
  - web qua client `chat-web`;
  - iOS/Android qua `chat-mobile`;
  - macOS/Windows/Linux qua `chat-desktop`.
- Điều này đúng ở `chat.hoandat.com` và ở `chat.<d>` của mọi tenant đã bật chat.
- Đăng xuất ở IdP hoặc thu hồi ở `/account` thì app chat biết để cắt phiên.

**Constraints:**
- Giữ mọi quy tắc trong `CLAUDE.md` của repo này: chỉ Google/GitHub, không gửi email, mọi document mang `tenantId`, không thêm URL hay tên cố định của `hoandat.com` vào code chạy, không log secret hay token.
- Tenant `hoandat.com`, Localman và Tunelo không được đổi hành vi. Riêng snapshot client/discovery được phép thay đổi đúng ở phần thêm client chat.

**Non-goals:**
- Không cấp access token có audience API cho chat (chat tự cấp phiên của mình, chỉ cần ID token và userinfo).
- Không có token exchange cho chat.
- Không có scope `telegram` cho chat.
- Không có kênh API nội bộ từ xa (chỉ cần khi chat chuyển khỏi `.65`; làm ở plan khác).
- Không gửi sự kiện audit sang chat.

**Acceptance:**
1. Web `chat-web` (Code + PKCE):
   - đăng nhập, refresh và back-channel logout (có `sid`) chạy được ở tenant chính và tenant thử `inetdev.io.vn`;
   - refresh token gắn với phiên IdP: đăng xuất ở IdP thì lần refresh sau nhận `invalid_grant`.
2. Native `chat-mobile` (redirect `<scheme>:/auth/callback`) và `chat-desktop` (redirect `http://127.0.0.1:<cổng bất kỳ>/auth/callback`):
   - đăng nhập Code + PKCE và nhận refresh token;
   - refresh token trượt 30 ngày, không có trần 90 ngày;
   - mỗi máy là một grant thu hồi được ở `/account`.
3. API nội bộ:
   - nhận vai `chat` với Basic credentials riêng;
   - `GET /internal/tenants/lookup?host=chat.<d>` và `?host=<x>.chat.<d>` trả đúng tenant.
4. Tenant phải bật chat ở `/admin` thì mới bị kiểm DNS và được cấp chứng chỉ cho `chat.<d>`, `*.chat.<d>`. Tenant chưa bật chat không bao giờ bị đình chỉ vì thiếu bản ghi DNS của chat.
5. Không nhận domain có nhãn đầu `chat` làm tenant (cả IdP lẫn provisioner).
6. Job kiểm grant của backend chat (gọi thẳng IdP qua loopback) không bị giới hạn 60 request/phút ở `/token` chặn. Request đi qua nginx vẫn theo hạn mức cũ.
7. App chat xuất hiện ở `/apps` (3 ngôn ngữ), README, `docs/integration-guide.md`.
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm check:tokens` sạch.

## Quyết định khi lập plan (2026-10-14)

| Câu hỏi | Chọn | Ai quyết |
|---|---|---|
| App chat có tham gia hệ sinh thái, tenant theo domain từ v1 không | Có; domain `chat.hoandat.com` và `chat.<d>` | user |
| Backend chat chạy ở đâu | Chung server `.65` giai đoạn đầu; API nội bộ qua loopback | user |
| Cho phép sửa repo này | Có | user |
| Refresh token của client native | Cấp theo chính sách client như `chat-web` (`issueRefreshToken`), không cần `offline_access` hay `prompt=consent`; không gắn phiên trình duyệt; không trần 90 ngày (tập miễn trần gồm `tunelo-cli`, `chat-mobile`, `chat-desktop`) | AI, user có thể bác |
| Consent cho client native first-party | Giữ một trang duyệt lần đầu trên mỗi máy, dùng câu first-party ("Cho phép {app} trên máy này?"), không có nhãn "Ứng dụng bên ngoài" | AI, user có thể bác |
| Host chat của tenant | Tuỳ chọn theo tenant: owner bật ở `/admin`; tenant chính bật sẵn | AI (tránh đình chỉ tenant đang chạy), user có thể bác |
| Hạn mức `/token` cho backend chat | Request vào thẳng listener của IdP qua loopback (không qua nginx, không có `X-Forwarded-For`) dùng bucket riêng cấu hình được; nginx luôn ghi đè `X-Forwarded-For` nên request từ ngoài không giả được | AI, kiểm lại ở phase 03 |
| Audience/resource cho chat | Không có; `chat-*` được phép `allowed_resources` rỗng như `hoandat-account` | AI |

## Phases

| # | Phase | Tier | Phụ thuộc | Trạng thái |
|---|---|---|---|---|
| 01 | [Client chat và mô hình tenant](./phase-01-chat-clients-and-tenant-model.md) | L | — | done (commit `0c0020d`, nhánh `feat/chat-app-clients`) |
| 02 | [Host chat theo tenant, API nội bộ, chứng chỉ](./phase-02-chat-hosts-internal-api-certs.md) | L | 01 | done: phần còn lại bị ADR 0006 thay (xem dưới) |
| 03 | [Hạn mức refresh, `/account`, `/apps`, tài liệu](./phase-03-refresh-limit-account-apps-docs.md) | M | 01 | done trừ bucket loopback (hoãn, xem dưới) |
| 04 | [Triển khai và nghiệm thu với app chat](./phase-04-deploy-and-acceptance.md) | M | 02, 03; app chat có Phase 2 chạy trên staging | done: deploy `84c169d` 2026-10-19 ([biên bản](../reports/deploy-261019-1430-chat-account-devices.md)) |

## Đối chiếu với code (2026-10-19)

- Phase 02: host `chat.<d>`, nhãn cấm `chat`, chứng chỉ, nginx và kiểm sở hữu đã có (commit `ecea962`, deploy 16/10), nhưng theo ADR 0006 hiện hành `chat.<d>` là host **bắt buộc** của mọi tenant, không bật theo tenant ở `/admin`. Backend chat chạy một process mỗi tenant với `TENANT_ID`, `OIDC_ISSUER` tĩnh, không gọi `/internal/tenants/lookup`; vai `chat` của API nội bộ chưa có. User quyết 2026-10-19 (Jev 0,97): đóng phần bật chat theo tenant ở `/admin`; chỉ thêm vai `chat` khi backend chat thật sự gọi lookup.
- Phase 03: `/apps` có Chat ở tenant chính (`e14f8d2`); README và `docs/integration-guide.md` có ba client chat (`045bd02`). `/account` liệt kê và đăng xuất riêng từng máy `chat-mobile`, `chat-desktop` (cả `scribe-mobile`), app gửi được `device_name`: đã làm 2026-10-19, test `chat-clients-flow.test.ts`. Bucket hạn mức `/token` qua loopback: user quyết 2026-10-19 (Jev 1,00) hoãn, làm cùng lúc repo chat đổi sang gọi `127.0.0.1` hoặc khi lượt refresh gần chạm 60 request/phút (backend chat hiện refresh qua issuer HTTPS công khai, tối đa 1 lần/giờ mỗi phiên).

## Rủi ro chính

| Rủi ro | Giảm thiểu |
|---|---|
| Thêm host chat vào kiểm sở hữu làm tenant đang chạy (`inetdev.io.vn`) bị đình chỉ vì thiếu DNS | Host chat chỉ được kiểm khi tenant đã bật chat (acceptance 4); test cho tenant chưa bật |
| Bucket loopback bị lạm dụng | Chỉ nhận request không qua nginx (không có `X-Forwarded-For`, địa chỉ nguồn loopback); listener IdP chỉ bind `127.0.0.1`; test giả `X-Forwarded-For` |
| Client native public bị mạo danh để lấy refresh token | PKCE bắt buộc; redirect native theo RFC 8252 (oidc-provider bỏ qua cổng loopback chỉ với `application_type: native`, đã đối chiếu `lib/models/client.js` upstream); trang duyệt lần đầu |
| Snapshot tenant chính đổi ngoài ý muốn | Chỉ cập nhật snapshot ở phần client chat; review diff snapshot |
| `.65` thêm tải từ chat | Ngoài phạm vi IdP; plan chat (Phase 13) có ngân sách RAM và ngưỡng chuyển |
