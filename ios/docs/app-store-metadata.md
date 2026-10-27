# Auth – hồ sơ App Store (bản nháp)

Bản nháp để dán vào App Store Connect cho app iOS quản lý tài khoản (`ios/`, client `account-ios`). Cách build và chạy: [../README.md](../README.md); bước phát hành: `plans/dattqh/261020-0742-ios-account-app/phase-05-app-store-release.md`. Ngôn ngữ chính của trang App Store: **Tiếng Việt**; thêm bản **English (U.S.)** bằng các dòng tiếng Anh dưới đây. Giao diện app có tiếng Anh (mặc định), tiếng Việt và tiếng Trung giản thể, theo ngôn ngữ đặt cho app trong Cài đặt của iPhone.

Ký tự đếm bằng số ký tự Unicode (App Store Connect đếm như vậy); số trong ngoặc là độ dài thật. Riêng từ khoá đếm theo byte UTF-8 (chữ có dấu tốn 2–3 byte), ghi cả hai.

Kiểm trên production ngày 27/10/2026 (curl): `/privacy` 200 (có email liên hệ, mục xoá tài khoản `#privacy-delete`), `/apps` 200, `/terms` 404, `/support` 404, AASA trả đúng `AM5C55N339.com.hoandat.account`. Trang đăng nhập của client `account-ios` hiện chỉ có **Google, GitHub và "App reviewer sign-in"**, chưa có nút Apple (xem mục [Việc phải làm trước khi nộp](#việc-phải-làm-trước-khi-nộp)).

## Thông tin app

| Trường | Giá trị |
|---|---|
| Bundle ID | `com.hoandat.account` |
| SKU | `account-ios` |
| Tên (≤ 30) | Giữ tên đang có: `Auth - Quản lý tài khoản` (24) · EN: `Auth - Account Manager` (22). Tên dưới icon trên iPhone là `Account` / `Tài khoản` (`CFBundleDisplayName`), không phải tên store |
| Phụ đề (≤ 30) | `Bảo mật, phiên và thiết bị` (26) · EN: `Sessions, devices & security` (28) |
| Danh mục chính / phụ | Utilities / Productivity |
| URL hỗ trợ | `https://auth.hoandat.com/privacy` (200, trang công khai có email liên hệ khi xoá tài khoản lỗi; chưa có trang hỗ trợ riêng — `/support`, `/help`, `/contact` đều 404) |
| URL chính sách quyền riêng tư | `https://auth.hoandat.com/privacy` |
| URL điều khoản (EULA tuỳ chỉnh, không bắt buộc) | Để trống, dùng EULA chuẩn của Apple: `https://auth.hoandat.com/terms` đang trả 404 |
| URL marketing (không bắt buộc) | `https://auth.hoandat.com/apps` (200, trang giới thiệu tài khoản dùng chung) |
| Bản quyền | `2026 hoandat` |
| Giá | Miễn phí, không mua trong app, không quảng cáo |
| Thiết bị | Chỉ iPhone (`TARGETED_DEVICE_FAMILY = 1`), iOS 18.0 trở lên (`IPHONEOS_DEPLOYMENT_TARGET = 18.0` trong `Config/Base.xcconfig`) |
| Mã hoá xuất khẩu | Chỉ HTTPS chuẩn, `ITSAppUsesNonExemptEncryption = false` trong Info.plist → không cần tài liệu |
| Phiên bản | `1.0.0` (build `1`) |

### Văn bản quảng bá (≤ 170)

VI (150): `Quản lý tài khoản hoandat.com trên iPhone: cách đăng nhập, phiên trình duyệt, thiết bị, ứng dụng có quyền truy cập, thông báo bảo mật và khoá Face ID.`

EN (140): `Manage your hoandat.com account on iPhone: sign-in methods, browser sessions, devices, apps with access, security alerts and a Face ID lock.`

### Mô tả

VI:

```
Auth là app quản lý tài khoản hoandat.com — một tài khoản dùng chung cho Localman, Tunelo, Chat, Scribe và các app khác của hoandat.com.

TÀI KHOẢN CỦA BẠN
• Xem và sửa tên hiển thị; xem email và nhà cung cấp đã xác minh email.
• Liên kết hoặc gỡ Google, GitHub và Apple. App không cho gỡ cách đăng nhập cuối cùng, để bạn không tự khoá mình ra ngoài.

KIỂM SOÁT TRUY CẬP
• Xem các trình duyệt đang đăng nhập, đăng xuất từng phiên hoặc tất cả.
• Xem các thiết bị đang đăng nhập và thu hồi thiết bị bạn không nhận ra.
• Xem app nào có quyền truy cập tài khoản và đọc được những gì; gỡ quyền chỉ bằng một lần chạm.
• Mọi thao tác nhạy cảm đều yêu cầu đăng nhập lại để xác nhận.

THÔNG BÁO BẢO MẬT
• Báo ngay khi có lần đăng nhập mới, khi cách đăng nhập thay đổi hoặc khi một quyền truy cập bị gỡ.
• Thông báo không bao giờ chứa mã hay đường link.

AN TOÀN TRÊN IPHONE
• Khoá app bằng Face ID hoặc mật mã máy.
• Khoá đăng nhập lưu trong Keychain của iPhone; app không bao giờ thấy mật khẩu của bạn.
• Mất mạng vẫn xem được thông tin đã tải lần cuối.

RIÊNG TƯ
• Không quảng cáo, không theo dõi.
• Xoá tài khoản ngay trong app: Cài đặt → Xoá tài khoản.

Giao diện tiếng Việt, tiếng Anh và tiếng Trung giản thể.
```

EN:

```
Auth manages your hoandat.com account — one account shared by Localman, Tunelo, Chat, Scribe and the other hoandat.com apps.

YOUR ACCOUNT
• See and edit your display name; see your email and which provider verified it.
• Link or remove Google, GitHub and Apple. The app never lets you remove your last sign-in method, so you can't lock yourself out.

CONTROL ACCESS
• See every browser signed in to your account and sign out one or all of them.
• See signed-in devices and revoke any you don't recognise.
• See which apps have access and what they can read; remove access in one tap.
• Every sensitive action asks you to sign in again first.

SECURITY NOTIFICATIONS
• Get notified about new sign-ins, sign-in method changes and removed access.
• Notifications never contain codes or links.

SAFE ON YOUR IPHONE
• Lock the app with Face ID or your passcode.
• Sign-in keys are kept in the iPhone Keychain; the app never sees a password.
• Offline, the last loaded account stays on screen.

PRIVATE
• No ads, no tracking.
• Delete your account in the app: Settings → Delete account.

Available in English, Vietnamese and Simplified Chinese.
```

Mỗi câu trên đối chiếu với code: liên kết/gỡ provider và chặn gỡ cách cuối (`SignInMethodsView.swift`), phiên/thiết bị/app (`SessionsView`, `DevicesView`, `AppsView`), `prompt=login` cho thao tác nhạy cảm (README, mục "How it talks to the IdP"), nội dung thông báo (`SettingsView.swift`), Keychain + offline (README), xoá tài khoản (`DeleteAccountView.swift`). Dòng "Apple" chỉ đúng khi Sign in with Apple đã bật trên production (hiện chưa); nếu nộp khi chưa bật thì bỏ chữ "và Apple" / "and Apple" ở hai bản.

### Từ khoá (ngăn bằng dấu phẩy, không dấu cách sau phẩy, không lặp từ trong tên)

VI (76 ký tự / 94 byte): `bảo mật,đăng nhập,phiên,thiết bị,face id,thông báo,hồ sơ,google,github,apple`

EN (94 ký tự / 94 byte): `security,login,sign in,sessions,devices,profile,face id,alerts,privacy,google,github,apple,sso`

Không dùng "mật khẩu" / "password" hay "2fa": app không có mật khẩu và không có xác thực hai lớp.

## Phân loại độ tuổi (Age Rating)

Kết quả mong đợi: **4+**. Trả lời bảng câu hỏi:

| Câu hỏi | Trả lời |
|---|---|
| Bạo lực (hoạt hình, thực tế, kéo dài), nội dung tình dục, khoả thân, ngôn từ thô tục, kinh dị, thuốc, rượu, thuốc lá, mô phỏng cờ bạc, chủ đề y tế, nội dung người lớn | None |
| Cờ bạc bằng tiền thật, cuộc thi | No |
| Trình duyệt web không giới hạn | No (chỉ mở trang đăng nhập của auth.hoandat.com trong `ASWebAuthenticationSession`; link chính sách mở trong Safari) |
| Nội dung do người dùng tạo được chia sẻ, chat giữa người dùng | No |
| Quảng cáo | No |
| Kiểm soát của phụ huynh, xác minh tuổi | No |
| Made for Kids | No |

## App Privacy ("nhãn dinh dưỡng")

Khớp `AccountApp/Resources/PrivacyInfo.xcprivacy`. **Không theo dõi (tracking): No** cho mọi loại. Mọi loại dưới đây: thu thập = Yes, liên kết với danh tính = **Yes**, mục đích = **App Functionality**.

| Nhóm App Store Connect | Loại | Ghi chú |
|---|---|---|
| Contact Info | Name | Tên hiển thị (sửa được trong Hồ sơ) |
| Contact Info | Email Address | Email tài khoản, do Google/GitHub/Apple cung cấp |
| Identifiers | User ID | Mã tài khoản, username |
| Identifiers | Device ID | Mã thiết bị APNs gửi lên IdP để nhận thông báo bảo mật (chỉ khi bật thông báo) |

Không thu thập: Location, Contacts, Health, Financial, User Content, Browsing/Search History, Usage Data, Diagnostics (không có SDK crash/analytics), Purchases, Sensitive Info. `UserDefaults` chỉ giữ hai công tắc của app (lý do `CA92.1`). Face ID chạy trên máy, app không nhận dữ liệu sinh trắc.

Lưu ý: trang `/privacy` hiện viết cho dịch vụ đăng nhập nói chung, chưa nhắc app iOS và mã thiết bị APNs. Nên thêm một câu ("App iPhone gửi mã thông báo của thiết bị để báo sự kiện bảo mật; tắt thông báo hoặc đăng xuất thì mã bị xoá") trước khi nộp, để nhãn App Privacy và chính sách khớp nhau.

## Ghi chú cho App Review

Dán vào **App Review Information → Notes** (tiếng Anh). Bản dưới dùng cho trạng thái production hiện tại (có "App reviewer sign-in", chưa có Apple); đoạn trong ngoặc vuông chỉ giữ khi Sign in with Apple đã bật.

```
Auth (shown on the Home Screen as "Account") manages a hoandat.com account: the single
sign-in service (auth.hoandat.com) run by the developer and shared by all our apps
(Localman, Tunelo, Chat, Scribe and others). The app shows the profile, sign-in methods,
browser sessions, devices, apps with access, security notifications, an optional Face ID
app lock, and account deletion.

Sign-in: tap "Sign in". The app opens auth.hoandat.com in the system sign-in sheet
(ASWebAuthenticationSession). Tap "App reviewer sign-in" and use the email and password
from the Sign-In Information fields. This creates (or reopens) a dedicated review account
with no real data. [Alternatively, tap "Sign in with Apple" and use any Apple ID: signing
in with a provider for the first time creates a new, empty account.] Google and GitHub
are also offered but need your own accounts.

Sensitive actions (removing app access, signing out all browsers, linking or removing a
sign-in method, deleting the account) open the same sign-in sheet again to confirm; sign
in the same way again.

Account deletion (5.1.1(v)): Account (main screen) → Settings → Delete account → type the
username shown in the field → "Delete account" → confirm "Delete account" → sign in again
in the sheet. The account is deleted immediately and the app returns to the sign-in screen
showing "Your account has been deleted." Signing in with the reviewer account afterwards
creates a fresh account, so deletion can be tested more than once.

Face ID (NSFaceIDUsageDescription): only used if the user turns on "Lock with Face ID" in
Settings. Notifications: optional security alerts (new sign-in, sign-in method changed,
access removed); they never contain codes or links.

Privacy policy: Settings → Privacy policy, also on the sign-in screen and at
https://auth.hoandat.com/privacy.

The interface follows the device language: English, Vietnamese or Simplified Chinese.
```

**Thông tin đăng nhập cho người duyệt (không bao giờ ghi vào repo):** email `REVIEW_LOGIN_EMAIL` và mật khẩu đã đặt cho ADR 0010 (`docs/decisions/0010-review-only-password-sign-in.md`) — chỉ nhập vào ô **Sign-In Information** của App Store Connect. Link "App reviewer sign-in" đang hiện trên production (kiểm 27/10/2026), nên tính năng này đang bật; đừng tắt hai biến `REVIEW_LOGIN_*` cho tới khi cả năm app được duyệt xong. Trước khi gửi: tự đăng nhập app bằng tài khoản đó một lần trên TestFlight để chắc nó chạy với client `account-ios`.

## Ảnh chụp màn hình

**Chưa có ảnh nào cho app này.** Không có công cụ tạo ảnh như Scribe (`pnpm run screenshots:app-store`); chụp từ Simulator hoặc máy thật.

Yêu cầu của Apple (trang [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), kiểm 27/10/2026): PNG/JPEG, **không kênh alpha**, 1–10 ảnh mỗi cỡ, dọc.

| Nhóm App Store Connect | Kích thước dọc | Cần không |
|---|---|---|
| iPhone 6.9" (Dynamic Island, lớn) — iPhone 17 Pro Max | 1320 × 2868 (hoặc 1290 × 2796, 1260 × 2736) | Nên có; là cỡ lớn nhất, ASC thu nhỏ cho máy nhỏ hơn |
| iPhone 6.3" (Dynamic Island, vừa) — iPhone 17 Pro | 1206 × 2622 (hoặc 1179 × 2556) | Trang Apple ghi đây là cỡ **bắt buộc** cho app iPhone |
| iPhone 6.5" (Face ID, lớn) | 1284 × 2778 hoặc 1242 × 2688 | **Không cần** khi đã có ảnh 6.9" (chỉ bắt buộc nếu thiếu 6.9") |
| iPhone Duo | 1398 × 2034 / 2007 × 2853 | Chưa cần: chỉ bắt buộc từ 4/2027 với app build bằng SDK iOS 27.1 trở lên |
| iPad | — | Không: app chỉ chạy trên iPhone |

Cách chụp gợi ý: Simulator iPhone 17 Pro Max và iPhone 17 Pro, đăng nhập bằng tài khoản duyệt (dữ liệu không thật), đặt ngôn ngữ app tiếng Việt cho bộ ảnh VI và tiếng Anh cho bộ EN, theme sáng, `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4`, chụp bằng `xcrun simctl io booted screenshot <file>.png`, rồi bỏ kênh alpha (ví dụ `sips -s format jpeg`). Che hoặc dùng email/username giả, không để lộ tài khoản thật.

Màn hình nên chụp, theo thứ tự tải lên:

1. **Tổng quan** (Overview) — avatar, tên, email "Verified by …", các mục kèm số đếm. Chú thích: "Mọi thứ của tài khoản ở một nơi".
2. **Phương thức đăng nhập** — Google/GitHub/Apple, một cái đã liên kết, dòng "Your only way to sign in…". "Liên kết Google, GitHub, Apple".
3. **Phiên trình duyệt** — vài trình duyệt với giờ đăng nhập và lần hoạt động cuối. "Đăng xuất trình duyệt lạ từ xa".
4. **Thiết bị** — có dòng "This device". "Thu hồi thiết bị bạn không nhận ra".
5. **Ứng dụng có quyền truy cập** — vài app hoandat.com kèm "Can read: …". "Biết app nào đọc được gì".
6. **Cài đặt** — "Lock with Face ID" và "Security notifications" đang bật. "Khoá Face ID và thông báo bảo mật".
7. (Tuỳ chọn) **Thông báo bảo mật trên màn hình khoá** — lần đăng nhập mới. Chỉ chụp được trên máy thật có APNs.

Không đưa màn hình Xoá tài khoản vào ảnh store. Màn hình đăng nhập có thể làm ảnh cuối nếu cần đủ số lượng, nhưng ít giá trị.

## Việc phải làm trước khi nộp

1. **Sign in with Apple chưa bật trên production** (trang đăng nhập 27/10/2026 chỉ có Google, GitHub). Guideline 4.8: app dùng đăng nhập Google/GitHub cho tài khoản chính phải có thêm một lựa chọn bảo vệ quyền riêng tư như Sign in with Apple. Bật theo [`docs/sign-in-with-apple.md`](../../docs/sign-in-with-apple.md) trước khi nộp; nếu chưa kịp thì nộp với bản ghi chú không có đoạn ngoặc vuông và bỏ chữ "Apple" khỏi mô tả, chấp nhận rủi ro bị loại 4.8.
2. Thêm câu về mã thiết bị APNs vào `/privacy` (mục App Privacy ở trên).
3. Chụp ảnh 6.9" và 6.3" (mục Ảnh chụp màn hình).
4. Điền Sign-In Information bằng tài khoản duyệt; kiểm nó đăng nhập được app trên TestFlight.
