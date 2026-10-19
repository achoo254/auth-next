---
phase: 3
title: "Hạn mức refresh, /account, /apps, tài liệu"
status: pending
priority: P1
effort: "M"
dependencies: [1]
---

# Phase 03: Hạn mức refresh, `/account`, `/apps`, tài liệu

## Goal

Ba việc: job kiểm grant của backend chat không bị giới hạn tần suất của `/token` chặn; người dùng thấy và thu hồi được từng máy chat ở `/account`; app chat có mặt ở `/apps` và trong tài liệu tích hợp.

## Phạm vi

- **Hạn mức `/token`:**
  - Hiện là 60 request/phút theo `(tenantId, IP)`, không có ngoại lệ (`src/http/security.ts:26-49`, khoá ở `:98-125`).
  - Thêm bucket riêng, cấu hình được qua env `TOKEN_RATE_LIMIT_LOOPBACK`, cho request vào thẳng listener của IdP: địa chỉ nguồn loopback và không có `X-Forwarded-For`.
  - nginx của mọi site luôn ghi đè `X-Forwarded-For` bằng `$remote_addr`, nên request từ ngoài luôn có header này và không lọt vào bucket loopback.
  - Backend chat gọi token endpoint ở `http://127.0.0.1:<PORT>` với `Host: auth.<d>` để dispatcher chọn đúng tenant.
  - Kiểm ở phase này: response và ID token vẫn mang `iss` đúng issuer HTTPS của tenant khi đi qua loopback.
- **`/account`:**
  - `src/account-portal/grant-directory.ts:113,152` hiện chỉ tách riêng `tunelo-cli`. Grant của `chat-mobile`/`chat-desktop` hiện ở nhóm thiết bị, mỗi grant một dòng, có thời điểm tạo, User-Agent lúc duyệt và nút thu hồi riêng.
  - Grant `chat-web` hiện như app web (giống Localman).
- **`/apps`:**
  - `src/app-directory/apps-catalog.ts:67-116` thêm app chat với địa chỉ `webApps.chat`, chỉ khi tenant đã bật chat.
  - Thêm icon chat vào `AppIconName`/`ICON_SHAPES` (`:15`, `:32-37`) và một tone có sẵn trong `tokens.css`, không thêm mã màu.
  - i18n 3 ngôn ngữ ở `src/i18n/messages/{en,vi,zh-cn}/apps.ts`.
  - `src/__tests__/apps-page.test.ts` cập nhật.
- **Tài liệu:**
  - README: bảng app (`:13-19`), mục client và audience, back-channel.
  - `docs/integration-guide.md`: bảng client mục 2 (`:60-63`), back-channel mục 5 (`:66`), ghi chú refresh native ở mục 8, consent native (`:113`), mục 11 tenant (host `chat.`, vai `chat`, bật chat theo tenant), và mục mới cho app chat theo khuôn mục 4 (luồng web, luồng native, gọi `/token` qua loopback).
  - Sửa câu `offline_access` ở `:81` cho khớp chính sách refresh native mới.
  - `docs/tenant-owner-guide.md`: bước bật chat và bản ghi DNS cần thêm.
  - `docs/deployment-guide.md`: biến env mới, vai `chat` của API nội bộ.
  - ADR 0006: thêm đoạn "app thứ ba" (host, nhãn cấm, bật theo tenant).

## Verification

- Test:
  - 200 request `/token` liên tiếp qua loopback không có `X-Forwarded-For` không bị 429;
  - cùng số request có `X-Forwarded-For` (giả qua nginx) bị 429 sau 60 request;
  - request có `X-Forwarded-For: 127.0.0.1` không được vào bucket loopback.
- Playwright: `/account` hiện hai máy chat riêng, thu hồi một máy thì refresh của máy đó nhận `invalid_grant`, máy kia vẫn chạy.
- `pnpm check:tokens` sạch; `/apps` render 3 ngôn ngữ.

## Risks

- Bucket loopback là một ngoại lệ bảo mật. Giữ nó hẹp: chỉ `/token`, chỉ khi không có `X-Forwarded-For`, chỉ địa chỉ loopback. Ghi vào ADR.
