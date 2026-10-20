---
phase: 5
title: "TestFlight, App Store và tài liệu"
status: pending
priority: P2
effort: "M"
dependencies: [4]
---

# Phase 05: TestFlight, App Store và tài liệu

## Goal

App có trên TestFlight rồi được Apple duyệt lên App Store; tài liệu ghi cách phát hành bản sau.

## Việc của user (cần tài khoản Apple Developer, AI không làm thay)

- Phase 00 đã xong (Apple sign-in bật ở production, App ID, khoá APNs, app record). Đặt khoá `.p8` vào secret mount trên .65 (theo `docs/deployment-guide.md`) và điền `IOS_APP_ID`, không gửi qua chat.
- Chọn tên app trên store, cung cấp tài khoản GitHub dự phòng cho reviewer (hoặc chấp nhận chỉ hướng dẫn Sign in with Apple).
- Archive và upload lần đầu từ Xcode (hoặc tạo App Store Connect API key nếu muốn upload từ CI sau này).

## Files to Create / Modify

- Create `docs/ios-app.md`: build, ký, cấu hình (`IOS_APP_ID`, `APNS_*`), phát hành TestFlight/App Store, ghi chú review, checklist App Privacy, cách kiểm AASA.
- Modify `README.md` (link tới `docs/ios-app.md`), `CLAUDE.md` (một dòng: app iOS ở `ios/`, client `account-ios`, API `/api/account` chỉ cho client này, ADR 0009).
- Modify `docs/deployment-guide.md`: biến mới và secret APNs.

## Steps

1. Deploy phase 01–03 lên production bằng `infra/deploy.sh` (skill `hoandat-auth-ops-prod`), có backup DB trước; kiểm `/.well-known/apple-app-site-association` trả đúng JSON và `Content-Type: application/json`.
2. Build TestFlight, user cài trên máy thật, chạy hết danh sách kiểm của phase 04 với APNs production.
3. Chuẩn bị store: ảnh chụp (iPhone 6.9" và 6.5", dữ liệu mẫu, che email/ID theo quy tắc ảnh chụp), mô tả vi/en, URL hỗ trợ và `/privacy`, App Privacy (định danh người dùng, email, tên; dùng cho chức năng app; không theo dõi), mã hoá xuất khẩu (chỉ HTTPS chuẩn → miễn).
4. Ghi chú review: app quản lý tài khoản của hệ thống đăng nhập hoandat; đăng nhập bằng Sign in with Apple với Apple ID bất kỳ (tạo tài khoản mới); chỉ đường xoá tài khoản (Cài đặt → Xoá tài khoản); tài khoản GitHub dự phòng nếu có.
5. Nộp review; bị loại thì sửa theo lý do, ghi vào `docs/ios-app.md`.

## Validation

- App ở trạng thái "Ready for Distribution"; tải từ App Store trên máy sạch, đăng nhập và xoá một tài khoản thử thành công.
- CI xanh ở commit được phát hành.

## Risk / Rollback

- Bị loại 4.2: đọc lý do, đề xuất bổ sung với user (mọi tính năng mới ngoài plan cần user duyệt) rồi nộp lại.
- Bị loại 2.1 do reviewer không đăng nhập được: thêm tài khoản GitHub review, ghi rõ bước.
- Gỡ khỏi store: App Store Connect "Remove from Sale"; IdP giữ client để người đã cài vẫn dùng hoặc gỡ client để vô hiệu.
