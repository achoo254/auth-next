---
phase: 0
title: "Điều kiện tiên quyết ở Apple"
status: pending
priority: P1
effort: "S"
dependencies: []
---

# Phase 00: Điều kiện tiên quyết ở Apple

## Goal

Trước khi làm app trên máy thật (phase 04 bước 2), cần có ba thứ:

- tài khoản Apple Developer Program đã được duyệt;
- Sign in with Apple đã bật ở production;
- các định danh Apple cần cho app.

## Bối cảnh đã đo

- `docs/deployment-guide.md:163`: Sign in with Apple "chưa bật (19/10/2026, chờ Apple duyệt tài khoản developer)". Cách bật được mô tả trong `docs/sign-in-with-apple.md`.
- Các biến `APPLE_*` đều tuỳ chọn (`src/config/apple-env.ts:25-35`). Thiếu chúng thì nút Apple không hiện.
- Thiếu Sign in with Apple thì app có đăng nhập Google sẽ trái 4.8, và reviewer khó đăng nhập (2.1).

## Việc của user (AI không làm thay)

1. Xác nhận tài khoản Developer Program (team của Scribe) đã được duyệt, và ghi lại team ID vào `.env` trên .65, không gửi qua chat.
2. Bật Sign in with Apple theo `docs/sign-in-with-apple.md`. Kiểm nút Apple hiện ở trang đăng nhập production.
3. Tạo App ID `com.hoandat.account` với các capability: Associated Domains, Push Notifications, Sign in with Apple.
4. Tạo khoá APNs `.p8` (dùng chung khoá Apple sign-in hay khoá riêng tuỳ user; khuyến nghị dùng khoá riêng để thu hồi độc lập).
5. Tạo app record trong App Store Connect.

## Phần AI làm

- Sau khi user bật Apple: kiểm `/.well-known/openid-configuration` và trang đăng nhập production qua skill `hoandat-auth-ops-prod`, chỉ đọc.
- Cập nhật `docs/deployment-guide.md:163` khi Apple đã bật.

## Validation

- Trang đăng nhập `https://auth.hoandat.com` hiện nút Apple; đăng nhập Apple thành công bằng một Apple ID thử.

## Risk / Rollback

- Apple duyệt chậm: phase 01–03 vẫn làm và deploy được; phase 04 dựng UI trên simulator với `auth.hoandat.com`, nhưng không kiểm được universal link trên máy thật.
