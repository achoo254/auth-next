---
phase: 1
title: "ADR 0009 và xoá tài khoản (web)"
status: in-progress
priority: P2
effort: "L"
dependencies: []
---

# Phase 01: ADR 0009 và xoá tài khoản (web)

## Goal

Người dùng tenant chính xoá được tài khoản của mình ở `/account`, ngay lập tức và không hoàn tác. Một service duy nhất làm việc xoá, để phase 02 gọi lại từ API của app.

## Bối cảnh đã đo

- **Chưa có chức năng xoá:**
  - `AccountRepository` (`src/accounts/account-repository.ts`, 161 dòng) không có hàm xoá.
  - `/privacy` ghi "liên hệ {email}" (khoá `privacy.rights.body` trong `src/i18n/messages/{vi,en,zh-cn}/privacy.ts`).
- **Hàng rào có sẵn:**
  - `findActiveById` lọc `disabledAt: { $exists: false }` (`account-repository.ts:59-66`).
  - `account-linking.ts:68,81` và `account-tokens.ts:75` cũng đọc `disabledAt`.
  - Chưa chỗ nào ghi `disabledAt`.
- **Revoke Apple:** `revokeUnlinked` (`src/account-portal/revoke-unlinked.ts:12-31`). Hàm này không làm gì khi Apple đang tắt (dòng 19-23).
- **Đăng xuất phiên kèm back-channel logout tới RP:** `revokeSession` (`src/account-portal/session-directory.ts:171-189`).
- **Thu hồi grant:**
  - `revokeGrants` (`src/account-portal/revoke-access.ts:28-38`, có `forgetDeviceGrants`) và `grantIdsOf` (8-25).
  - `revokeGrant` dùng `Grant.find`, nên bỏ qua grant đã hết hạn mà TTL chưa dọn (`grant-directory.ts:119-134`).
- **Ghi bất đồng bộ:** `trackSessions` upsert `session_meta` không await (`session-directory.ts`); `recordDeviceGrant` ghi sau consent (`src/interactions/consent-handler.ts:57-75`).
- **Token một lần:** `AccountTokens.revokeFor(kind, accountId)` xoá theo từng kind (`src/accounts/account-tokens.ts:134-136`); `TokenCollection.deleteFor` không kèm kind thì xoá tất (`src/accounts/one-time-tokens.ts:118-124`).
- **Collection có dữ liệu của tài khoản:**
  - Trong `TENANT_COLLECTIONS` (`src/tenants/tenant-collections.ts:11-18`): `accounts`, `one_time_tokens`, `session_meta`, `grant_meta`, `oidc_session`, `oidc_grant`, `oidc_interaction` (`payload.session.accountId`, `payload.result.login.accountId`; TTL 30 phút, `src/oidc/provider.ts:76`), các model grantable theo `grantId` (`src/oidc/mongo-adapter.ts:52-59`).
  - Ngoài danh sách đó: claim nhận domain mang `accountId` (`src/tenants/tenant-claims.ts:22-25,34,70-80`).
- **Audit:**
  - `record(type, sub, data, context?)` (`src/audit/audit-outbox.ts:52-57`); context có IP và User-Agent.
  - Chỉ sự kiện đã gửi mới có `expiresAt` (`src/audit/audit-queue.ts:52`). README:130 ghi sự kiện chờ quá 30 ngày bị xoá IP/UA.
- **Owner của tenant** là danh tính upstream, không phải tài khoản (`src/tenants/tenant-document.ts:5-10`, `src/tenants/claim-service.ts:49`). Xoá tài khoản không đổi quyền owner.
- **Route nhạy cảm:** `portalRoute(..., { csrf: true, recentLogin: true })`. Thiếu CSRF thì trả 303 tới `/account?notice=expired`; đăng nhập đã cũ thì 303 sang authorize `prompt=login` (`src/account-portal/portal-session.ts:146-167`).

## Files to Create / Modify

- Create `docs/decisions/0009-account-deletion.md`. Nội dung:
  - Xoá thật, ngay lập tức, chỉ ở tenant chính.
  - Thứ tự các bước như dưới đây.
  - Những gì còn lại sau khi xoá:
    - sự kiện audit chỉ còn `sub` và loại sự kiện, IP/UA bị xoá trắng; sự kiện chưa gửi thì nằm tới khi gửi được;
    - Apple không thu hồi được nếu tại thời điểm xoá Apple đang tắt hoặc lỗi mạng (lỗi được log, không chặn việc xoá).
  - Quyền owner tenant gắn với danh tính Google/GitHub, nên vẫn còn.
  - Đăng nhập lại tạo tài khoản mới.
- Create `src/accounts/account-deletion.ts`: `AccountDeletion.delete(accountId, { source: "web" | "app" }, context)`, nhận tenant khi dựng. Các bước:
  0. **Hàng rào:** `updateOne({ _id, ...inTenant, disabledAt: { $exists: false } }, { $set: { disabledAt }, $inc: { securityVersion: 1 } })`. Không áp được thì trả `not_found`. Từ đây tài khoản không đăng nhập, link, refresh hay dùng token một lần được nữa.
  1. Đọc lại document (bỏ qua bộ lọc `disabledAt`) để lấy `revocationToken` mới nhất. Với mỗi provider có `revocationToken`, gọi `revokeUnlinked`.
  2. Với mỗi `Session` của tài khoản: `revokeSession` (kèm back-channel). Sau đó `revokeGrants(services, id, await grantIdsOf(...))`.
  3. **Quét theo `accountId`** ở tầng dữ liệu, không dùng danh sách lấy trước:
     - các model grantable theo mọi `grantId` của tài khoản, kể cả grant đã hết hạn;
     - `oidc_grant`, `oidc_session`, `oidc_interaction`, `session_meta`, `grant_meta`, `push_devices` (khi phase 03 có);
     - claim;
     - `accountTokens.revokeAllFor(accountId)` (hàm mới, gọi `deleteFor` không kèm kind).
  4. Xoá trắng `ip`/`userAgent` của mọi sự kiện `audit_outbox` có `sub` này.
  5. Xoá document `accounts` (`_id`, `inTenant`, đã có `disabledAt`).
  6. `record("account.deleted", accountId, { source }, context)`.
- Create `src/accounts/account-deletion-data.ts`: phần quét theo collection, vì chỉ module tầng dữ liệu được gọi `db.collection`. Cập nhật danh sách của test `tenant-source-scan`. Mỗi file giữ dưới 200 dòng.
- Modify `src/accounts/account-repository.ts`: `disable(id)`, `findForDeletion(id)`, `deleteDisabled(id)`.
- Modify `src/accounts/account-tokens.ts`: `revokeAllFor(accountId)`.
- Modify `src/audit/audit-events.ts`: `account.deleted` (`{ source }`); `src/audit/audit-outbox.ts`: `scrubContextFor(sub)`.
- Modify nơi dựng `services`: thêm `accountDeletion` (chỉ tenant chính).
- Create `src/account-portal/account-delete-routes.ts`:
  - `GET /account/delete`: trang xác nhận, liệt kê hậu quả, gồm cả "quyền owner domain gắn với tài khoản Google/GitHub vẫn còn". Người dùng gõ đúng `@username`.
  - `POST /account/delete` với `portalRoute(..., { csrf: true, recentLogin: true })`. Sai username thì redirect kèm notice và không xoá. Xong thì xoá cookie phiên và trả trang "Đã xoá tài khoản".
- Modify `src/account-portal/account-routes.ts`, `account-sections.ts`, `account-overview.ts`: thêm mục "Xoá tài khoản" cuối trang, chỉ ở tenant chính.
- Modify `static/css/account.css`: nút nguy hiểm, chỉ dùng biến của `tokens.css`.
- Modify `src/i18n/messages/{vi,en,zh-cn}/account.ts`, `account-actions.ts`, `privacy.ts`: `privacy.rights.body` hướng dẫn xoá ở `/account` (và trong app), mô tả đúng dữ liệu còn lại sau khi xoá.
- Tests:
  - `src/__tests__/account-deletion.test.ts`. Các ca:
    - đếm document trước và sau, cho từng collection của `TENANT_COLLECTIONS` và cho claim;
    - có grant đã hết hạn và interaction dở dang;
    - tài khoản khác và tenant khác không bị đụng;
    - Apple revoke được gọi qua `fake-apple.ts`; Apple lỗi vẫn xoá; Apple tắt vẫn xoá;
    - back-channel logout tới client có `backchannel_logout_uri`;
    - IP/UA trong outbox bị xoá trắng;
    - audit ghi sau cùng;
    - đăng nhập lại tạo `sub` mới;
    - refresh token cũ trả `invalid_grant`, `/me` với token cũ trả 401;
    - đăng nhập song song sau hàng rào bị từ chối;
    - chạy lại sau khi lỗi giữa chừng thì hoàn tất.
  - `src/__tests__/account-delete-routes.test.ts`:
    - thiếu CSRF: 303 tới `/account?notice=expired`;
    - đăng nhập cũ: 303 sang `prompt=login`;
    - sai username: không xoá.

    Cả ba ca: số document không đổi. Tenant sổ không có route xoá.
  - e2e `e2e/account-delete.spec.ts`.

## Steps

1. Viết ADR 0009, thêm một dòng vào danh sách ADR ở `CLAUDE.md`.
2. Viết test đếm document trước (TDD), rồi viết service xoá.
3. Route, trang xác nhận, i18n, CSS; chạy `pnpm check:tokens`.
4. Sửa `/privacy`; cập nhật snapshot nếu trang chính đổi.
5. Local chỉ chạy `pnpm lint`, `pnpm typecheck`, `pnpm test src/__tests__/account-deletion.test.ts src/__tests__/account-delete-routes.test.ts`. Sau đó push và `gh run watch`.

## Validation

- Log của lượt xoá không chứa `revocationToken`, email hay cookie (test bắt log).
- Backup DB trên .65 có từ trước lần deploy đầu (`hoandat-auth-ops-prod`).

## Risk / Rollback

- **Xoá nhầm do CSRF hoặc phiên bị chiếm:** CSRF, đăng nhập trong 10 phút, gõ lại username.
- **Lỗi giữa chừng:** tài khoản ở trạng thái `disabledAt`, không đăng nhập được. Chạy lại xoá sẽ hoàn tất (service nhận tài khoản đã disabled). Cần thêm một lệnh vận hành `pnpm accounts:finish-deletion <id>` để chạy lại.
- **Lùi:** revert commit. Dữ liệu đã xoá chỉ khôi phục được từ backup .65.
