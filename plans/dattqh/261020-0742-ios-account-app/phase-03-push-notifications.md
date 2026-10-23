---
phase: 3
title: "Thông báo đẩy APNs"
status: pending
priority: P2
effort: "M"
dependencies: [2]
---

# Phase 03: Thông báo đẩy APNs

## Goal

Thiết bị còn grant sống nhận thông báo đẩy khi có sự kiện bảo mật trên tài khoản. Thiếu cấu hình APNs thì tính năng tắt, IdP vẫn chạy.

## Sự kiện được đẩy

| Loại (`PushKind`) | Khi nào | Ghi ở |
|---|---|---|
| `new-sign-in` | Đăng nhập thành công tạo phiên mới hoặc grant thiết bị mới | `finishLogin` / chỗ ghi `grant.created` kind `device` |
| `provider-linked` | Liên kết Google/GitHub/Apple | cùng chỗ ghi `method.linked` |
| `provider-unlinked` | Huỷ liên kết | cùng chỗ ghi `method.unlinked` (`AccountLinks`) |
| `email-reclaimed` | Email bị lấy lại | cùng chỗ `bot.notice.emailReclaimed` |
| `access-revoked` | Phiên, thiết bị hoặc ứng dụng bị thu hồi từ nơi khác | route thu hồi |

Tham số chỉ gồm `provider`, `clientName`, thời điểm. Không có email, IP, mã, link hay token. Thiết bị gây ra sự kiện (cùng `grantId`) không nhận thông báo của chính nó.

## Bối cảnh đã đo

- **Telegram:**
  - `notifyTelegram(services, account, key, params)` (`src/telegram/notify.ts:13-34`) chỉ có 2 khoá (`telegram-bot.ts:22-24`).
  - `emailReclaimed` truyền `{email}` (`upstream-finish-routes.ts:78-82`).
  - Push dùng bộ khoá i18n riêng `push.*`, không placeholder `{email}`.
- **Các đường làm grant chết:**
  - thu hồi ở `/account`;
  - `revokeSession` (`session-directory.ts:186`);
  - `/token/revocation` và phát hiện refresh token dùng lại, cả hai bắt được bằng listener `grant.revoked` (`src/audit/provider-events.ts:15`, `sliding-grants.ts:57-60`);
  - TTL khi hết hạn (`oidc-indexes.ts:17-18`, `sliding-grants.ts:10-12`).
- **Collection mới:** phải có `tenantId`, nằm trong `TENANT_COLLECTIONS`, có test cô lập, nằm trong `IDP_COLLECTIONS` của `deploy/self-hosted/migrate/export-tenant.sh:30-35`.
- **Chỉ tenant chính:** integration từ env không bao giờ cho tenant sổ.
- **Nghiên cứu:**
  - `node:http2` + JWT ES256 (`jose`);
  - host sandbox và production;
  - 410: gỡ token trừ khi thiết bị đăng ký lại sau mốc thời gian Apple trả.

## Files to Create / Modify

- Create `src/push/push-devices.ts`:
  - collection `push_devices` với các trường `tenantId`, `accountId`, `grantId`, `token`, `environment`, `locale`, `updatedAt`, `expiresAt`;
  - unique `{ tenantId, token }`, chỉ mục `{ tenantId, accountId }`;
  - TTL trên `expiresAt`, trượt cùng grant ở `rotateRefreshToken` như `grant_meta`.
- Create `src/push/apns-client.ts`:
  - phiên HTTP/2, tự mở lại khi `goaway`, `close` hoặc `error`;
  - JWT provider làm mới mỗi 50 phút;
  - timeout ngắn;
  - chỉ log mã trạng thái và `reason`.
- Create `src/push/notify-account.ts`: `notifyAccount(services, account, kind: PushKind, params, { exceptGrantId })`.
  - Gọi Telegram như cũ.
  - Gửi APNs tới thiết bị có `Grant.find(grantId)` còn sống và đúng `accountId`. Grant chết thì xoá dòng thiết bị.
  - Gửi kiểu fire-and-forget, có bắt lỗi.
- Modify các call site ở bảng trên. Ba chỗ `notifyTelegram` hiện có chuyển sang `notifyAccount`.
- Modify `src/audit/provider-events.ts`: khi `grant.revoked` thì xoá `push_devices` của grant.
- Modify `src/account-portal/revoke-access.ts`, `account-actions.ts`, `AccountDeletion`: dọn `push_devices`.
- Modify `src/account-api/account-api-routes.ts`:
  - `PUT /api/account/push-device`, gắn với grant của access token;
  - `DELETE /api/account/push-device`.
- Modify:
  - `src/tenants/tenant-collections.ts`, `deploy/self-hosted/migrate/export-tenant.sh`;
  - `src/config/env.ts` (`APNS_KEY_PATH` là file secret mount read-only, cùng `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`; thiếu biến nào thì tắt), `.env.example`;
  - `docs/deployment-guide.md`.
- Modify `src/i18n/messages/{vi,en,zh-cn}/`: thêm `push.ts`.
- Tests:
  - `push-devices.test.ts`: cô lập tenant; đăng ký lại; TTL trượt.
  - `apns-client.test.ts` (server HTTP/2 giả):
    - 200;
    - 410 gỡ token;
    - `BadDeviceToken` gỡ token;
    - 5xx giữ token;
    - GOAWAY thì mở lại phiên;
    - header JWT đúng.
  - `notify-account.test.ts`:
    - duyệt mọi `PushKind`, payload không khớp regex email/URL;
    - thiết bị có grant đã thu hồi, revoke qua `/token/revocation` hay hết hạn đều không nhận;
    - thiết bị gây ra sự kiện không nhận;
    - thiếu cấu hình thì không gửi.

## Steps

1. Repository, collection, migrate script.
2. Client APNs, test với server giả.
3. `notifyAccount`, các call site, route đăng ký, listener `grant.revoked`.
4. Tài liệu deploy. Khoá `.p8` do user tạo (phase 00) và đặt vào secret mount trên .65.

## Validation

- Gửi thật ở phase 04 (sandbox, máy thật) và phase 05 (production qua TestFlight).
- Log test không chứa token thiết bị hay JWT provider.

## Risk / Rollback

- **APNs chậm:** gửi kiểu fire-and-forget nên không làm chậm request.
- **Lùi:** bỏ biến `APNS_*` là tắt tính năng; collection còn lại vô hại.

## Trạng thái (23/10/2026)

Code xong ở local, chưa commit, chưa chạy CI. Bước 1–3 xong; bước 4: tài liệu xong, khoá `.p8` và env trên .65 chờ user (phase 00).

- [x] `src/push/push-devices.ts`: collection `push_devices` (unique `{tenantId, token}`, chỉ mục account và grant, TTL `expiresAt`), trượt cùng grant trong `rotateRefreshToken` (giờ cả `grant_meta` cũng trượt cho mọi grant thiết bị). Đã thêm vào `TENANT_COLLECTIONS`, `IDP_COLLECTIONS` của `export-tenant.sh`, `purgeAccountData`, danh sách module dữ liệu của `tenant-source-scan`.
- [x] `src/push/apns-client.ts` + `apns-response.ts`: `node:http2` + `jose`, JWT ES256 làm mới mỗi 50 phút (bỏ khi Apple báo `ExpiredProviderToken`/`InvalidProviderToken`), mở lại phiên khi GOAWAY/close/error, timeout 10 giây, log chỉ mã trạng thái, `reason` và 6 ký tự cuối của token.
- [x] `src/push/notify-account.ts` + `push-payload.ts`: `PushEvent` có kiểu, khoá `push.*` ba thứ tiếng, tên ứng dụng chỉ cho client first-party. Call site: `finishLogin` (trừ client thiết bị), consent của grant thiết bị, liên kết (web, tự liên kết theo email, app), huỷ liên kết, email bị lấy lại, thu hồi phiên/thiết bị/ứng dụng. Ba chỗ `notifyTelegram` cũ chuyển sang `notifyAccount` (Telegram giữ nguyên nội dung).
- [x] Dọn thiết bị: listener `grant.revoked` (`forgetRevokedPushDevices`), `forgetDeviceGrants`, xoá tài khoản; lúc gửi kiểm `Grant.find` và xoá dòng có grant chết.
- [x] `PUT`/`DELETE /api/account/push-device` (`src/account-api/push-device-routes.ts`); thiếu `APNS_*` thì `PUT` trả `204` và không lưu gì.
- [x] Env `APNS_KEY_PATH`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (`src/config/ios-env.ts`), `.env.example`, `docs/deployment-guide.md`.
- Test: `apns-client` (4), `push-devices` (4), `notify-account` (7), `ios-env` (2).
- Ghi chú: lần đăng nhập lại `prompt=login` của chính app tạo grant mới nên máy đó có thể nhận một thông báo `new-sign-in` cho chính nó trước khi kịp thu hồi grant cũ và đăng ký lại token. Gửi thật (sandbox/production) để phase 04/05.
