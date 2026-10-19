---
phase: 1
title: "Sổ tenant: chế độ tự host, nhận chỉ bằng TXT"
status: done
priority: P2
effort: "L"
dependencies: []
---

# Phase 01: Sổ tenant — chế độ tự host, nhận chỉ bằng TXT

## Goal

Sổ tenant biết chế độ của mỗi tenant (`hoandat` hoặc `self`). Lượt nhận ở chế độ `self` chỉ xác minh TXT, không bao giờ kiểm bản ghi A, không vào hàng đợi chứng chỉ, không dựng runtime; tenant chạy trên hoandat không đổi hành vi nào.

## Bối cảnh đã đo

- `TenantStatus = "pending_claim" | "claimed" | "active" | "suspended"` (`src/tenants/tenant.ts:9`); `SERVING_STATUSES = ["claimed", "active"]` (`src/tenants/tenant-document.ts:57`).
- Nhận domain: `startClaim`, `verifyClaim` (`src/tenants/claim-service.ts`), trần `MAX_TENANTS_PER_ACCOUNT = 2`, `hasCapacity` theo `TENANT_MAX_ACTIVE` và bộ nhớ trống.
- Kiểm lại sở hữu: `checkAllOwnership` (`src/tenants/ownership-check.ts`), đình chỉ sau `SUSPEND_AFTER_FAILURES = 3`; `TenantLifecycle` (`src/tenants/tenant-lifecycle.ts`) có `expireUnactivated`, `activateIfClaimed`, `restoreOwnership`, `deleteUnactivated`.
- Phản hồi DNS từng bản ghi: `src/tenants/claim-dns-feedback.ts`; trang: `src/tenants/claim-page.ts`, route `src/tenants/claim-routes.ts`.
- Hàng đợi chứng chỉ cho provisioner: `src/tenants/internal-certificates.ts`; tra tenant theo Host: `src/tenants/internal-lookups.ts`, `src/http/tenant-dispatcher.ts`.

## Files to Create / Modify

- Modify `src/tenants/tenant.ts`, `src/tenants/tenant-document.ts`: thêm `hosting: "hoandat" | "self"` (document cũ không có trường thì là `hoandat`) và trạng thái `self_hosted` (không nằm trong `SERVING_STATUSES`). Lượt nhận `self` qua `pending_claim` → `enrolling` (đã xác minh TXT, chờ đổi gói) → `self_hosted`.
- Modify `src/tenants/claim-service.ts`: `startClaim` nhận chế độ; `verifyClaim` ở chế độ `self` chỉ kiểm TXT; `hasCapacity` bỏ qua tenant `self`; `ownsTooMany` vẫn đếm.
- Modify `src/tenants/ownership-check.ts`, `src/tenants/tenant-lifecycle.ts`: tenant `self` chỉ kiểm TXT; mất TXT 3 lần liền thì gỡ bản ghi (không có runtime để đình chỉ); `enrolling` quá hạn gói thì hết hạn như `claimed` chưa kích hoạt.
- Modify `src/tenants/internal-certificates.ts`, `src/tenants/internal-lookups.ts`, `src/tenants/runtime-registry.ts`: tenant `self` không bao giờ vào hàng đợi chứng chỉ, không được tra ra theo Host, không có runtime.
- Modify `src/tenants/claim-page.ts`, `src/tenants/claim-routes.ts`, i18n `src/i18n/messages/{en,vi,zh-cn}/tenants.ts`: chọn chế độ (ẩn khi `SELF_HOSTED_CLAIMS` tắt), cảnh báo "hoandat không backup, không vận hành thay bạn", danh sách bản ghi chỉ có TXT ở chế độ `self`.
- Modify `src/config/env.ts`: `SELF_HOSTED_CLAIMS` (boolean, mặc định `false`).
- Modify `src/audit/audit-events.ts`: `tenant.claimed` mang chế độ.
- Tests: `src/__tests__/tenant-claim-service.test.ts`, `tenant-claim-flow.test.ts`, test mới `tenant-self-hosted.test.ts`.

## Steps

1. Thêm kiểu, trường và trạng thái; đọc document cũ không có `hosting` là `hoandat` (không migrate dữ liệu, không đổi chỉ mục).
2. Rẽ nhánh `verifyClaim` và lượt kiểm lại theo chế độ; viết test trước cho từng nhánh.
3. Chặn tenant `self` ở hàng đợi chứng chỉ, tra theo Host, runtime registry, trần tenant.
4. Trang claim: lựa chọn chế độ, cảnh báo, bản ghi DNS theo chế độ; ba ngôn ngữ; snapshot tenant chính không đổi khi cờ tắt.

## Validation

- Test: lượt nhận `self` qua với chỉ TXT và bản ghi A trỏ IP lạ; không có job chứng chỉ, `lookupByHost` trả 404, không có runtime.
- Test: lượt kiểm lại tenant `self` không gọi resolver cho bản ghi A; mất TXT 3 lần thì bản ghi bị gỡ và domain nhận lại được.
- Test: tenant `hoandat` giữ nguyên mọi hành vi cũ (bộ test hiện có qua nguyên vẹn); snapshot `primary-tenant-snapshot` không đổi khi `SELF_HOSTED_CLAIMS` tắt.
- Cổng đầy đủ của repo sạch.

## Risk / Rollback

- Rủi ro: một nhánh quên kiểm `hosting` làm tenant `self` có runtime trên hoandat. Giảm bằng test quét: mọi chỗ đọc `SERVING_STATUSES` hay hàng đợi chứng chỉ có test cho tenant `self`.
- Lùi: tắt `SELF_HOSTED_CLAIMS`; document `self` không có runtime nên không ảnh hưởng tenant khác. Deploy lại commit cũ an toàn khi chưa có tenant `self` nào (code cũ coi `enrolling`/`self_hosted` là trạng thái lạ: kiểm trước bằng đếm).

## Kết quả (17/10/2026)

- Làm khác plan một chỗ: sổ tenant **không** thêm trường `hosting`. Chế độ suy từ trạng thái (`enrolling`, `self_hosted` là `SELF_HOSTED_STATUSES`, `isSelfHosted` trong `src/tenants/tenant-document.ts`), vì tenant tự host không bao giờ ở trạng thái nào khác; chỉ lượt nhận (`tenant_claims`) mang `hosting`. Không có document cũ nào phải đọc lại.
- Tenant tự host mất TXT 3 lần liền thì bản ghi bị xoá (audit `tenant.released`, lý do `ownership`); `enrolling` quá 48 giờ cũng bị xoá (`not-enrolled`). Việc kiểm định kỳ chạy khi có `SERVICE_IPV4` **hoặc** `SELF_HOSTED_CLAIMS`.
- File mới: `src/tenants/claim-checks.ts` (giới hạn, chế độ được mở, phép kiểm DNS theo chế độ), `src/tenants/claim-records.ts` (bảng bản ghi, lựa chọn chế độ), `src/tenants/claim-route-state.ts` (thông báo, danh tính); tách ra để mỗi file ≤ 200 dòng.
- Sửa kèm một lỗi có từ trước trên `/claim`: nút chọn chủ sở hữu có email dài làm trang tràn ngang 80 px ở 390 px; `.btn-block` giờ xuống dòng (`static/css/app.css`). Đã chụp lại trang đăng nhập để chắc nút Google/GitHub không đổi.
- e2e bật `SELF_HOSTED_CLAIMS` (`e2e/support/e2e-server.ts`) và có test nhận domain tự host (`e2e/domain-claim.spec.ts`).
- Cổng: `pnpm lint`, `typecheck`, `check:tokens` sạch; `pnpm test` 546/546 (81 file, thêm `tenant-self-hosted.test.ts` 6 test và `claim-page.test.ts` 4 test); `pnpm test:e2e` 11/11. Snapshot tenant chính chỉ thêm khoá i18n mới, không đổi chữ cũ.
- Chưa deploy; production giữ `SELF_HOSTED_CLAIMS` tắt (mặc định).
