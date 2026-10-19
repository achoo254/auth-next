---
phase: 2
title: "Gói enrollment và đổi gói"
status: done
priority: P2
effort: "M"
dependencies: [1]
---

# Phase 02: Gói enrollment và đổi gói

## Goal

Tenant `enrolling` nhận được một gói enrollment ký, dùng một lần. Bản cài tự host đổi gói khi đã chạy ở `https://auth.<d>`; đổi thành công thì tenant chuyển `self_hosted`. Gói không bao giờ chứa secret.

## Bối cảnh đã đo

- Khoá ký ES256 của tenant chính lấy qua `primarySigningKey` (`src/oidc/jwks.ts`); không bao giờ `keys[0]` (CLAUDE.md).
- Token một lần gắn tài khoản đi qua `services.accountTokens`; gói enrollment gắn với tenant chứ không với tài khoản, nên cần kho riêng (collection mới thì thêm vào `TENANT_COLLECTIONS`, có `tenantId`, test cô lập).
- Liên kết một lần sang `/admin` của tenant: `src/tenants/admin-session.ts` (mẫu cho hạn ngắn và dùng một lần).
- Nối mạng ra ngoài trong test thay bằng fetch giả (mẫu ở `src/__tests__/helpers/fake-upstreams.ts`).

## Files to Create / Modify

- Create `src/tenants/enrollment-bundle.ts`: cấp gói (JWS ES256, `iss` là issuer của tenant chính, `aud` `https://auth.<d>`, `exp` 24 giờ, `jti` ngẫu nhiên; claim: domain, tên hiển thị, owner `{ provider, providerId }`, khoá công khai mà bản cài sẽ gửi khi đổi gói ở phase 05 để trống); xác minh gói (dùng ở bản cài).
- Create `src/tenants/enrollment-redeem.ts`: đổi gói ở gateway. Kiểm chữ ký, hạn, `jti` chưa dùng (ghi có điều kiện), tenant đang `enrolling`, TXT còn đúng, rồi gọi `https://auth.<d>/.well-known/hoandat-enrollment?nonce=<n>` và so khớp chữ ký thử thách bằng khoá mà bản cài khai trong yêu cầu đổi gói. Đạt thì `self_hosted`, ghi audit `tenant.self_hosted`.
- Modify `src/tenants/claim-routes.ts`, `src/tenants/claim-page.ts`: nút tải gói cho tenant `enrolling` của owner; route POST đổi gói (API JSON, rate limit, không CSRF vì gọi từ máy chủ, không cookie).
- Modify `src/oidc/provider.ts` (`OIDC_ROUTES` không đổi) hoặc router riêng: endpoint thử thách `/.well-known/hoandat-enrollment` chỉ bật ở bản cài đang chờ đổi gói (env `ENROLLMENT_BUNDLE_PATH`).
- Modify `src/tenants/env-tenant.ts`, `src/config/env.ts`: bản cài đọc `ENROLLMENT_GATEWAY` (URL gateway, cấu hình, không cố định trong code) và gói; owner trong gói thành owner của trang quản trị bản cài.
- Modify `src/audit/audit-events.ts`: `tenant.enrollment_issued`, `tenant.self_hosted` (không chứa gói, `jti` hay nonce).
- Tests: test mới `enrollment-bundle.test.ts`, `enrollment-redeem.test.ts`.

## Steps

1. Định dạng gói và hàm cấp/xác minh; test hạn, `aud`, chữ ký sai, gói bị sửa.
2. Đổi gói ở gateway: ghi `jti` có điều kiện (đổi hai lần song song thì một lần thua); thử thách qua fetch giả trong test.
3. Phía bản cài: đọc gói, phục vụ thử thách, gửi yêu cầu đổi gói lúc khởi động khi chưa đổi; xong thì tắt endpoint thử thách.
4. Trang quản trị bản cài mở cho đúng owner trong gói ở lần đăng nhập đầu tiên.

## Validation

- Test: gói hết hạn, đổi lần hai, sai `aud`, TXT đã mất, thử thách sai đều bị từ chối và tenant vẫn `enrolling`.
- Test: log và audit không chứa gói, `jti`, nonce hay chữ ký (CLAUDE.md: không log token).
- Test: tài khoản khác owner đăng nhập đầu tiên ở bản cài không mở được trang quản trị.

## Risk / Rollback

- Rủi ro: gói lộ trước khi đổi. Giảm bằng hạn ngắn, dùng một lần và thử thách phải trả lời từ `https://auth.<d>` (kẻ có gói mà không giữ DNS thì không đổi được).
- Lùi: gói chưa đổi hết hạn và tenant về hết hạn như phase 01; gói đã đổi không gọi lại được (tenant đã `self_hosted`, gỡ bằng cách xoá TXT).

## Kết quả (17/10/2026)

- Làm khác plan ba chỗ, ADR 0007 §3 đã cập nhật theo:
  - Không có kho `jti`: đổi gói là phép ghi có điều kiện `enrolling` → `self_hosted` (`completeEnrollment`), nên gói tự hết dùng sau lần đổi đầu. Không cần collection mới.
  - Bản cài không có trang quản trị: domain là tenant chính, cấu hình bằng `.env`. Danh tính owner trong gói được giữ cho phase 05.
  - Tải gói là POST có CSRF và đăng nhập gần đây (như mở `/admin`), không phải nút GET.
- Gateway: `src/tenants/enrollment-bundle.ts` (cấp/kiểm gói), `enrollment-redeem.ts` (đổi gói), `enrollment-routes.ts` (`POST /claim/tenants/:id/enrollment` tải gói, `POST /claim/enrollments` đổi gói), `enrollment-challenge.ts` (gọi thử thách: HTTPS, chỉ địa chỉ công khai kiểm lúc kết nối, không redirect, 10 giây, 16 KiB), `public-address.ts`. Sổ tenant lưu `installKey` (JWK công khai + thumbprint) và `enrolledAt`; audit `tenant.self_hosted`.
- Bản cài: `src/tenants/install-enrollment.ts`, `install-enrollment-env.ts`; env `ENROLLMENT_GATEWAY`, `ENROLLMENT_BUNDLE_PATH`, `ENROLLMENT_KEY_PATH` (cả ba hoặc không). Gói sai thì không khởi động; đổi gói 1 giây sau khi chạy, thử lại mỗi phút, dừng hẳn khi gateway trả lỗi không đổi được.
- Test bắt được một lỗi thật khi viết: `BlockList` của Node so IPv4 với luật IPv4-mapped IPv6, nên một danh sách chung chặn mọi IPv4; đã tách hai danh sách.
- Cổng: lint, typecheck, check:tokens sạch; `pnpm test` 563/563 (82 file, thêm `tenant-enrollment.test.ts` 17 test chạy thật cả hai phía qua loopback); `pnpm test:e2e` 11/11 (test tự host thêm bước tải gói và gọi route đổi gói qua HTTP). Snapshot tenant chính chỉ thêm `claim.tenants.bundle`.
- Chưa deploy.
