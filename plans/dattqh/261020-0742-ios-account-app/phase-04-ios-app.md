---
phase: 4
title: "App SwiftUI"
status: pending
priority: P2
effort: "XL"
dependencies: [0, 2, 3]
---

# Phase 04: App SwiftUI

## Goal

App iOS "Tài khoản" (`com.hoandat.account`, iOS 18+, SwiftUI, không dependency ngoài) làm được mọi việc của `/account` qua `/api/account`, có Face ID và thông báo đẩy, chạy đúng trên máy thật.

## Bối cảnh

- Mẫu iOS sẵn có: `one-scribe/web/ios` (Capacitor, `CODE_SIGN_STYLE = Automatic`, không ghi `DEVELOPMENT_TEAM` trong repo, không có CI iOS). App này native nên chỉ mượn cách ký: team chọn cục bộ, CI không ký.
- Nghiên cứu (`../reports/researcher-261020-0742-ios-account-app.md`): `ASWebAuthenticationSession` + `Callback.https`, PKCE S256, `prefersEphemeralWebBrowserSession = true`; refresh token trong Keychain `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, không gắn Face ID; refresh tuần tự; Face ID `.deviceOwnerAuthentication`, tắt mặc định, `NSFaceIDUsageDescription`; `PrivacyInfo.xcprivacy` khai `UserDefaults` lý do `CA92.1`.
- Màu và chữ: theo `static/css/tokens.css` (bản sao Localman) để app và web cùng nhận diện; chuỗi vi/en/zh-Hans như IdP.

## Cấu trúc

```
ios/
  AccountApp.xcodeproj
  AccountApp/
    App/            AccountApp.swift, AppState.swift, AppLock.swift (Face ID, che màn hình khi nền)
    Auth/           AuthSession.swift (authorize + PKCE + ASWebAuthenticationSession), TokenStore.swift (Keychain), TokenRefresher.swift (actor, refresh một lần một lúc), Discovery.swift
    API/            AccountAPI.swift (URLSession, async/await, Codable DTO khớp account-api-view.ts), APIError.swift
    Features/       Overview, Profile, SignInMethods (link và unlink, cả hai cần đăng nhập lại), Sessions, Devices, Apps, DeleteAccount (đăng nhập lại `prompt=login` rồi xác nhận), Settings (Face ID, thông báo, ngôn ngữ theo hệ thống, link Quyền riêng tư)
    Push/           PushRegistrar.swift (xin quyền, gửi token + environment)
    Design/         Tokens.swift (màu/khoảng cách từ tokens.css), components dùng chung
    Resources/      Localizable.xcstrings (vi, en, zh-Hans), Assets, PrivacyInfo.xcprivacy, AccountApp.entitlements (associated domains `applinks:<issuer host>` và `webcredentials:<issuer host>`, aps-environment)
  AccountAppTests/  PKCE, TokenStore, TokenRefresher (hai refresh song song → một request), decode Fixtures/account.json (fixture chung với test hợp đồng Node), AppLock, ReauthFlow (đổi sang grant mới rồi thu hồi grant cũ)
  AccountAppUITests/ khởi động, màn đăng nhập (không gọi mạng thật)
  Config/           Base.xcconfig (ISSUER mặc định tenant chính, bundle id), Local.xcconfig.example (DEVELOPMENT_TEAM, không commit)
```

## Files to Create / Modify

- Create toàn bộ `ios/` như trên.
- Create `.github/workflows/ios.yml` (workflow riêng vì `paths` chỉ lọc được ở cấp workflow; `ci.yml` hiện một job không lọc): kích hoạt khi `ios/**`, `src/account-api/**`, `src/oidc/account-ios-client.ts` đổi; runner macOS ghim phiên bản, chọn Xcode 26 bằng `DEVELOPER_DIR`, destination simulator lấy từ `xcrun simctl list` thay vì tên cố định; `xcodebuild test -scheme AccountApp CODE_SIGNING_ALLOWED=NO`.
- Modify `biome.json` / `tsconfig.json` nếu cần loại `ios/` khỏi lint TS; `.gitignore` (`xcuserdata`, `Local.xcconfig`, `DerivedData`).
- Modify `README.md`: mục "App iOS" (build cục bộ, chọn team, chạy trên máy thật).

## Steps

1. Khung project, xcconfig, entitlements, tokens màu; CI build xanh.
2. Auth: discovery, authorize + PKCE + universal link callback, đổi code, Keychain, refresh tuần tự, đăng xuất (`DELETE /api/account/push-device`, rồi revoke refresh token, rồi xoá Keychain). **Kiểm trên máy thật ngay bước này** với `auth.hoandat.com` sau khi phase 02 deploy và phase 00 xong (AASA cần team ID thật); `Callback.https` không chạy thì dừng và hỏi user trước khi lùi về scheme riêng.
3. API client và màn Tổng quan, Hồ sơ, Phiên, Thiết bị, Ứng dụng.
4. Đăng nhập lại (`prompt=login`): nhận `id_token` mới, chuyển sang token mới, revoke refresh token cũ; mục Thiết bị vẫn chỉ một dòng cho máy này (test + kiểm tay).
5. Phương thức đăng nhập: unlink và link (`POST .../link` trả URL, mở trong `ASWebAuthenticationSession`, kết thúc ở `/ios/linked`), cả hai sau đăng nhập lại.
6. Xoá tài khoản: màn giải thích hậu quả (mất cách đăng nhập vào Localman/Tunelo/Chat/Scribe bằng tài khoản này; quyền owner domain vẫn theo Google/GitHub), đăng nhập lại, gõ username, gọi `DELETE`, xoá Keychain, về màn chào với thông báo "Đã xoá".
7. Face ID khoá app (tuỳ chọn, mặc định tắt), che nội dung ở app switcher.
8. Thông báo đẩy: xin quyền sau đăng nhập (không xin ngay lúc mở), đăng ký token kèm environment, mở thông báo thì vào màn tương ứng.
9. Ngôn ngữ, Dynamic Type, VoiceOver nhãn, chế độ tối.

## Validation

- `xcodebuild test` xanh trên CI.
- Trên máy thật (user cùng làm): đăng nhập Google, GitHub, Apple; thu hồi thiết bị này từ web → app nhận 401 và về màn đăng nhập; liên kết/huỷ liên kết; thông báo đẩy sandbox khi liên kết provider mới; xoá một tài khoản thử từ app.
- Không token nào trong `UserDefaults`, log hay ảnh chụp app switcher.

## Risk / Rollback

- Rủi ro: `Callback.https` không bắt được trên máy thật (AASA cache, thiếu `webcredentials`). Lùi về scheme `com.hoandat.account:/auth/callback` chỉ khi user đồng ý (scheme riêng chiếm được bởi app khác, PKCE thành lớp chặn duy nhất): đổi redirect ở `account-ios-client.ts`, thêm `nativeRedirectSchemes` (`src/http/security.ts`), đổi một hằng trong app, deploy lại IdP.
- Rủi ro: tốn phút macOS trên CI. Workflow riêng chỉ chạy khi app hoặc hợp đồng API đổi.
