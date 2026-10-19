---
phase: 6
title: "Nghiệm thu đầu-cuối và tài liệu"
status: in-progress
priority: P2
effort: "M"
dependencies: [4, 5]
---

# Phase 06: Nghiệm thu đầu-cuối và tài liệu

## Goal

Chạy đủ sáu tiêu chí nghiệm thu của `plan.md` trên một tenant mới tự host và một tenant chuyển từ hoandat, rồi cập nhật tài liệu cho tenant và cho vận hành.

## Steps

1. Tenant mới: nhận domain ở chế độ tự host, cài bundle trên VM sạch, đổi gói, chạy các luồng của phase 03, bắt traffic ra.
2. Tenant chuyển: dùng một tenant thử (không phải tenant của khách) chuyển theo phase 05, kiểm số đếm, refresh token, `kid`; purge sau thời hạn (có thể rút ngắn cho tenant thử).
3. Bật `SELF_HOSTED_CLAIMS` trên production khi user yêu cầu tường minh.
4. Tài liệu:
   - `docs/tenant-owner-guide.md` và trang `/guide/domain` (`src/guide/`): chế độ tự host, yêu cầu máy, trách nhiệm của tenant; chụp lại ảnh bằng `pnpm guide:screenshots`.
   - `docs/deployment-guide.md`: quy trình chuyển tenant, purge, xử lý gói enrollment.
   - `CLAUDE.md`: thêm ADR 0007 vào danh sách quyết định; quy tắc mới (tenant `self_hosted` không bao giờ có runtime, chứng chỉ, block nginx trên hoandat; gói enrollment không chứa secret).
   - `docs/decisions/0007-self-hosted-tenants.md`: trạng thái "chấp nhận", ghi kết quả đo.

## Validation

- Đủ sáu tiêu chí nghiệm thu, có số đếm và lệnh đã chạy.
- Cổng đầy đủ của ba repo sạch.

## Risk / Rollback

- Bật cờ trên production mà bundle chưa ổn thì tenant kẹt ở `enrolling` và hết hạn sau 24 giờ; tắt cờ là đủ.

## Tiến độ (17/10/2026)

- Tài liệu: `/guide/domain` có mục "Chạy domain trên máy chủ của bạn" (ba ngôn ngữ, chỉ hiện khi `SELF_HOSTED_CLAIMS` bật; nhãn nút khớp `/claim`), `docs/tenant-owner-guide.md`, `CLAUDE.md` (ADR 0007, quy tắc tenant tự host), trạng thái ADR 0007. Sửa tài liệu phase 05: tenant `migrating` thôi phục vụ ngay khi bấm chuyển (`SERVING_STATUSES`), không phải tới lúc đổi DNS.
- Release 0.2.0 (localman-next `a5b9470`, chat-next `fa317f5`): sáu image qua `cosign verify`, danh tính sai bị từ chối; image có `export/import-tenant` và `migrate/`.
- LAB 183 cập nhật 0.1.0 → 0.2.0: lần đầu nginx đụng cổng 80 vì lượt cập nhật chạy `update.sh` của 0.1.0 (chưa nạp `compose.override.yaml`) và script thoát không lùi bản khi `up -d` lỗi. Sửa: `up -d` lỗi cũng lùi bản. Chạy lại: đủ service, kiểm phase 03 như cũ.
- Cổng hoandat-auth: lint, typecheck, tokens sạch; 577/577 test; e2e 11/11.

Còn lại (cần user): deploy IdP và Localman lên .65, bật `SELF_HOSTED_CLAIMS`, VM công khai và domain thử cho bước 1–2; ảnh chụp `pnpm guide:screenshots` khi có trang thật của chế độ tự host.
