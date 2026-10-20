# Research: app iOS "Tài khoản" (com.hoandat.account) cho IdP auth.hoandat.com

Ngày: 2026-10-20. Phạm vi: chỉ nghiên cứu, không sửa code. Nguồn chính là tài liệu Apple (độ tin cậy cao nhất), release notes/registry của thư viện, sau đó mới tới forum và blog (chỉ dùng để thấy lý do bị reject thực tế).

## Kết luận nhanh

1. **Rủi ro review lớn nhất là 4.2 và 2.1, không phải code.** Nếu app chủ yếu bọc trang `/account` trong web view thì sẽ bị coi là "repackaged website" (4.2). Vì vậy UI phải native, đọc/ghi qua một account API JSON (dùng access token của IdP). Reviewer cũng phải đăng nhập được mà không bị Google/GitHub chặn bằng 2FA (2.1).
2. **Xoá tài khoản** phải bắt đầu được ngay trong app. App phải gọi Apple `/auth/revoke` cho tài khoản có liên kết Apple (repo đã có `revokeUnlinked`, dùng lại được), báo cho người dùng biết bao lâu thì xoá xong, và xác nhận khi đã xoá xong.
3. **Đăng nhập:** dùng `ASWebAuthenticationSession`, PKCE S256, client public mới (tương tự `chat-mobile`). Tự viết bằng URLSession thay vì dùng AppAuth. Callback chọn universal link `https` (iOS 17.4+).
4. **APNs:** gọi trực tiếp `node:http2` và ký JWT bằng `jose` (repo đã có sẵn). Nếu không muốn tự viết thì phương án hai là `@parse/node-apn` 8.1.0.
5. **iOS tối thiểu: 18.0.** Build bằng Xcode 26 (bắt buộc từ 28/04/2026). CI dùng App Store Connect API key với fastlane hoặc `altool`. `notarytool` không thay được bước upload iOS.

## 1. App Store Review Guidelines

| Guideline | Yêu cầu | Áp dụng cho app này |
|---|---|---|
| 4.2 Minimum Functionality | App phải "vượt lên trên một website đóng gói lại". 4.2.2 cấm app chỉ là "web clippings… collection of links". | Danh sách session, thiết bị, provider, app đã cấp quyền phải là màn native. Thêm các giá trị riêng của app native: push cảnh báo bảo mật, khoá Face ID, thu hồi session ngay trên máy. Mở web chỉ để đăng nhập. |
| 4.8 Login Services | Nếu dùng social login cho tài khoản chính thì phải có thêm một lựa chọn tương đương: chỉ lấy tên và email, cho ẩn email, không theo dõi để quảng cáo. | Sign in with Apple đáp ứng điều này, và IdP đã có Apple (ADR 0008). Tenant sổ chỉ có Google/GitHub, nên app chỉ phục vụ tenant chính, hoặc phải ẩn tenant sổ. Guideline không bắt dùng nút Apple native, nhưng nút Apple trên trang IdP phải theo HIG. |
| 5.1.1(i) Privacy policy | Có link trong metadata App Store Connect **và** trong app. Chính sách phải nói rõ dữ liệu thu thập, cách lưu giữ/xoá và cách rút đồng ý. | Thêm trang `/privacy` trên IdP và link từ màn Cài đặt. |
| 5.1.1(v) Account deletion | Xem chi tiết bên dưới. | |
| 2.1(a) App Completeness | "include demo account info (and turn on your back-end service!) if your app includes a login". Demo mode thay thế thì phải được Apple duyệt trước. | Xem mục Demo account. |
| App Privacy labels | Khai trong App Store Connect. | Khai: Contact Info (email, name), Identifiers (User ID, Device ID = APNs token), "Linked to user", không tracking. |
| Privacy manifest | `PrivacyInfo.xcprivacy` khai các required-reason API. | Có dùng `UserDefaults` thì khai `NSPrivacyAccessedAPICategoryUserDefaults` với lý do `CA92.1`. Đặt `NSPrivacyTracking=false`. Nếu không thêm SDK bên thứ ba thì manifest rất ngắn. |

**Chi tiết 5.1.1(v)** (theo trang "Offering account deletion in your app" của Apple):
- Người dùng phải bắt đầu xoá được trong app, ở chỗ dễ tìm như phần Cài đặt tài khoản. Chỉ "tạm khoá" hay "vô hiệu hoá" thì không đạt.
- **Link web được chấp nhận** khi bước hoàn tất cần website, với điều kiện link dẫn **thẳng** tới trang xoá. Không được bắt người dùng gọi điện, gửi email hay chat với support (chỉ ngành bị quản lý chặt mới được ngoại lệ).
- **Thời hạn:** không bắt buộc xoá ngay hay xoá tự động. Được phép xử lý "reasonably timed", nhưng phải báo trước sẽ mất bao lâu và xác nhận khi xong. Được yêu cầu xác thực lại (ở đây là `recentLogin`), nhưng không được làm khó quá mức.
- **Sign in with Apple:** gọi REST `revoke` (`POST https://appleid.apple.com/auth/revoke` với `client_id`, `client_secret` JWT, `token` và `token_type_hint`) và xử lý server-to-server notifications. Repo đã lưu `revocationToken`, nên luồng xoá chỉ cần dùng lại `revokeUnlinked`. CLAUDE.md cũng đã ghi yêu cầu này.
- Phải xoá dữ liệu không bắt buộc giữ theo luật. Dữ liệu nào giữ lại (ví dụ audit outbox) thì phải nói rõ cho người dùng.
- Khuyến nghị: dùng màn native, xác thực lại (Face ID và `recentLogin` qua IdP), rồi `DELETE` lên account API. Server revoke Apple, thu hồi mọi grant, ghi audit và trả về "đã xoá" hoặc "sẽ xoá trong N ngày". Không nên chỉ mở link web, vì nó yếu hơn về 4.2 dù vẫn được chấp nhận.

**Demo account khi chỉ có Google/GitHub/Apple.** Theo ADR 0004 không thể có mật khẩu demo. Các phương án xếp theo thứ tự ưu tiên:
1. Trong App Review notes, ghi rằng reviewer có thể "Sign in with Apple bằng Apple ID bất kỳ; tài khoản mới được tạo tự động". Reviewer có sẵn Apple ID nên ít ma sát nhất. Nhược điểm: tài khoản mới không có dữ liệu, nên notes cần nói rõ cách tạo dữ liệu (đăng nhập web trên một máy khác để thấy session hoặc thiết bị).
2. Thêm một tài khoản GitHub riêng cho review (đặt email, mật khẩu, TOTP seed trong notes). Rủi ro: Google/GitHub có thể bật "Verify it's you" hoặc mã thiết bị vào lúc không đoán trước. Forum có báo bị reject 2.1 vì đúng lý do này (thread 849775, 764103), nên Google là lựa chọn kém nhất.
3. Demo mode cần Apple duyệt trước. Không khuyến nghị vì đi ngược ADR 0004 và CLAUDE.md (không có đường auto-login ngoài test).

## 2. Native OIDC trên iOS

- **User agent:** dùng `ASWebAuthenticationSession`, theo RFC 8252. Google chặn WKWebView bằng lỗi `disallowed_useragent` từ 2021, nhưng không chặn browser hệ thống. Ở đây Google chỉ là upstream của IdP, nên chỉ cần trang IdP không bao giờ chạy trong WKWebView.
- **Callback.** `.https(host:path:)` có từ iOS 17.4 và chỉ app sở hữu domain mới nhận được, nên an toàn hơn `customScheme`, vốn có thể bị app khác đăng ký trùng. Cấu hình cần thêm:
  - Associated Domains (`applinks:auth.hoandat.com`, và nhiều khả năng cả `webcredentials:`) cùng file AASA phục vụ trên IdP.
  - Forum báo lỗi "not associated with domain" và lỗi trên simulator, nên phải test trên máy thật.
  - Phương án dự phòng là custom scheme `com.hoandat.account:/oauth/callback`. Vì minimum là iOS 18 nên chỉ cần một kiểu callback, nhưng nên đăng ký cả hai redirect URI cho client để dễ lùi lại.
- **PKCE S256** là bắt buộc. oidc-provider v9 đã ép PKCE cho client public, và client mới là native public với `token_endpoint_auth_method: none`.
- **`prefersEphemeralWebBrowserSession`.** Nếu `true`, iOS không hiện hộp thoại "App wants to use … to sign in" và không dùng chung cookie với Safari, nên người dùng phải đăng nhập lại Google/GitHub. Nếu `false`, app có SSO với phiên IdP trên Safari. Khuyến nghị dùng `true`: app quản lý bảo mật nên muốn phiên tách biệt, và đăng xuất sạch. Đổi lại người dùng phải gõ lại thông tin đăng nhập upstream.
- **AppAuth-iOS hay tự viết.** AppAuth 3.0.0 (24/08/2026) là bản breaking, nâng minimum lên iOS 15 cho Xcode 27. Chưa thấy AppAuth hỗ trợ `Callback.https`. App chỉ có một IdP với discovery cố định, nên tự viết (URLSession, `CryptoKit` SHA256 cho PKCE, `ASWebAuthenticationSession`) chỉ khoảng 200–300 dòng, không thêm dependency và dùng được callback https. Chọn AppAuth thì đổi lấy luồng đã kiểm chứng nhưng phải tự bọc callback.
- **Refresh token.** Lưu vào Keychain với `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`: token không theo backup hay iCloud, và vẫn refresh được khi app chạy nền sau lần mở khoá đầu. **Không** gắn `biometryCurrentSet` vào item này, vì refresh nền và xử lý push sẽ hỏng. Refresh token xoay vòng một lần dùng, nên app phải serialize việc refresh (một `actor`), giống yêu cầu file lock của Tunelo CLI. Cần quyết định client mới có theo mô hình `chat-mobile` hay không (không cần `offline_access`, không chết theo phiên IdP).

## 3. APNs từ Node.js

- **Xác thực bằng token (.p8):** JWT ES256 với header `kid` (Key ID) và claim `iss` (Team ID), `iat`. Mỗi token dùng tối đa 1 giờ và không ký lại thường hơn mỗi 20 phút; vi phạm sẽ nhận `TooManyProviderTokenUpdates` hoặc `ExpiredProviderToken`. Gửi bằng HTTP/2 `POST /3/device/<token>` với header `apns-topic: com.hoandat.account` và `apns-push-type: alert`.
- **Host:** `api.sandbox.push.apple.com` cho build ký development (chạy từ Xcode). `api.push.apple.com` cho TestFlight và App Store. Nên lưu môi trường theo từng device token, vì token sandbox gửi lên host production sẽ nhận `BadDeviceToken`.
- **410 Unregistered:** ngừng gửi tới token đó. Chỉ xoá token nếu nó không được đăng ký lại sau `timestamp` trong body. Ngoài ra: 429/500/503 thì retry có backoff; 403 thì ký lại JWT. Header `apns-unique-id` chỉ có ở môi trường development, dùng để log và tra cứu.

So sánh thư viện (kiểm trên npm ngày 20/10/2026):

| Lựa chọn | Phiên bản / bảo trì | Dependency | Đánh giá |
|---|---|---|---|
| **Gọi trực tiếp `node:http2` + `jose`** | Node ≥22.12 đã có sẵn | 0 dependency mới | **Hạng 1.** Lượng push thấp (chỉ sự kiện bảo mật). Code khoảng 100 dòng, vừa giới hạn ≤200 dòng của repo, và tự kiểm soát được log (CLAUDE.md cấm log token). Tự viết phần giữ session, xử lý GOAWAY và cache JWT. |
| `@parse/node-apn` | 8.1.0, cập nhật 04/2026, Node 20/22/24 | jsonwebtoken, node-forge, verror | Hạng 2. Trưởng thành và có pool, nhưng kéo thêm node-forge vốn có lịch sử CVE. |
| `apns2` | 12.2.0, lần cuối 05/2025 | undici, fast-jwt | Hạng 3. API gọn nhưng nhịp phát hành chậm lại. |
| `node-apn-http2` | 1.2.0 (2022) | jsonwebtoken 8 | Loại vì bị bỏ rơi. |

Payload push chỉ nên chứa chuỗi chung chung, ví dụ "Có đăng nhập mới trên thiết bị X", cộng một id sự kiện. Không đưa mã, token hay link vào payload, theo đúng quy tắc audit hiện có. Nên gửi push từ dispatcher của audit outbox để `record` không bao giờ bị chặn.

## 4. Khoá app bằng Face ID (LocalAuthentication)

- **`NSFaceIDUsageDescription`** là bắt buộc trong Info.plist. Thiếu key này thì app bị kill khi gọi Face ID.
- **Policy:** dùng `.deviceOwnerAuthentication` (Face ID, rơi về passcode máy) thay vì `...WithBiometrics`, để người dùng không bị khoá ngoài khi Face ID lỗi. Khoá app chỉ là cổng UI; lớp bảo mật thật vẫn là passcode máy và token trong Keychain.
- **Cách làm:**
  - Khi `scenePhase` sang `.background`, phủ một màn che lên nội dung để snapshot trong app switcher không lộ email hay session. Khi về `.active` và quá thời gian ân hạn (ví dụ 30 giây), gọi `LAContext().evaluatePolicy`.
  - Mỗi lần xác thực tạo `LAContext` mới.
  - Có thể lưu `evaluatedPolicyDomainState` để phát hiện người dùng thêm khuôn mặt mới.
- Với thao tác nguy hiểm (xoá tài khoản, gỡ provider), Face ID không thay được `recentLogin` của IdP. Server vẫn phải kiểm `auth_time` hoặc buộc đăng nhập lại.
- Lưu ý: từ iOS 18 hệ thống đã có tính năng "Require Face ID" cho mọi app. Khoá trong app vẫn đáng làm vì có màn che và ân hạn, nhưng nên để mặc định tắt và là tuỳ chọn.

## 5. iOS tối thiểu và cách nộp

- **Minimum iOS 18.0.** Theo số liệu Apple ngày 7/6/2026, 86% iPhone ra trong 4 năm gần đây chạy iOS 26 và 11% chạy iOS 18, nên iOS 18 trở lên phủ khoảng 97%. Từ iOS 18 có sẵn `Callback.https`, `@Observable` và Observation. iOS 26 mới là minimum quá sớm vì sẽ mất khoảng 14% máy đủ điều kiện nhưng còn ở iOS 18. iOS 17 chỉ thêm khoảng 2–3% máy, đổi lại phải xử lý trường hợp trước 17.4 cho callback.
- **Toolchain:** từ 28/04/2026, mọi bản upload phải build bằng Xcode 26 với iOS 26 SDK. Theo nhịp mọi năm, có thể Xcode 27 sẽ thành bắt buộc vào khoảng tháng 4/2027, nhưng chưa xác minh.
- **Các bước:**
  1. Tạo App ID có các capability Push Notifications, Associated Domains, và Sign in with Apple nếu cần.
  2. Tạo record app trên App Store Connect.
  3. Khai privacy labels, privacy policy URL và thông tin cho App Review (notes, demo).
  4. Archive rồi upload, sau đó test nội bộ qua TestFlight (không cần review) trước khi test ngoài (Beta App Review) và nộp chính thức.
- **CI.** Tạo App Store Connect API key (`.p8`, Issuer ID, Key ID) với role App Manager, rồi chọn một trong hai đường:
  - **fastlane** (`app_store_connect_api_key`, `match` hoặc ký tự động, `build_app`, `upload_to_testflight`). Đây là cách phổ biến nhất.
  - **Không dùng fastlane:** `xcodebuild archive`, rồi `xcodebuild -exportArchive` với `method=app-store-connect`, rồi `xcrun altool --upload-app --apiKey … --apiIssuer …`. Với iOS, `altool` vẫn là công cụ upload hiện hành; `notarytool` chỉ thay `altool` cho việc notarize app macOS. Transporter là đường thủ công.
  - Runner phải là macOS. GitHub Actions có `macos-15`/`macos-26` với Xcode 26.
  - Khuyến nghị dùng fastlane vì quản lý signing gọn hơn. Nếu muốn ít dependency Ruby thì dùng đường xcodebuild + altool.

## Ma trận quyết định (đã xếp hạng)

| Quyết định | Chọn | Phương án thay thế | Lý do |
|---|---|---|---|
| OIDC lib | Tự viết | AppAuth 3.x | Một IdP, cần callback https, không thêm dependency |
| Callback | `.https` universal link | custom scheme | Chống app khác chiếm redirect; minimum iOS 18 cho phép |
| Ephemeral session | `true` | `false` (có SSO) | Phiên tách biệt cho app bảo mật |
| APNs | `node:http2` + `jose` | `@parse/node-apn` | Không thêm dependency, kiểm soát được log |
| iOS min | 18.0 | 17.0 / 26.0 | Phủ khoảng 97%, có đủ API cần dùng |
| Demo review | Sign in with Apple của reviewer + notes | Tài khoản GitHub review | Không phá ADR 0004, ít rủi ro 2FA |

## Nguồn

- Apple, chính thức: [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), [Offering account deletion](https://developer.apple.com/support/offering-account-deletion-in-your-app), [5.1.1 ref](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion), [Revoke tokens](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens), [Required reason API](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api), [APNs responses](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns), [Callback](https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession/callback), [Face ID login](https://developer.apple.com/documentation/localauthentication/logging-a-user-into-your-app-with-face-id-or-touch-id), [Upcoming requirements (Xcode 26)](https://developer.apple.com/news/upcoming-requirements/), [altool](https://help.apple.com/asc/appsaltool/en.lproj/static.html)
- Forum (độ tin cậy trung bình): [https callback < 17.4](https://developer.apple.com/forums/thread/769749), [webcredentials](https://developer.apple.com/forums/thread/805416), [simulator](https://developer.apple.com/forums/thread/763621), [demo bị Google chặn](https://developer.apple.com/forums/thread/849775), [2.1 reject](https://developer.apple.com/forums/thread/764103), [Auth0 https callback](https://support.auth0.com/center/s/article/auth0-https-scheme-does-not-work-for-ios-universal-link)
- Thư viện: [AppAuth-iOS 3.0.0](https://github.com/openid/AppAuth-iOS/releases), [@parse/node-apn](https://npmjs.com/package/@parse/node-apn), [apns2](https://cdn.jsdelivr.net/npm/apns2@12.2.0/README.md), [node-apn-http2](https://github.com/vlasky/node-apn-http2)
- Khác: [Google disallowed_useragent](https://developers.googleblog.com/2021/06/upcoming-security-changes-to-googles-oauth-2.0-authorization-endpoint.html), [iOS 26 adoption 06/2026](https://9to5mac.com/2026/06/10/ios-26-adoption-grows-but-still-lags-slightly-behind-ios-18/), [CLI upload 2026](https://newly.app/guides/app-store-connect-cli)

## Giới hạn của research

- Chưa đọc được toàn văn trang `ASWebAuthenticationSession.Callback`, LocalAuthentication và required-reason API, vì Apple render bằng JS. Các chi tiết này dựa vào kiến thức API, release notes và forum. Cần đối chiếu trong Xcode docs khi code.
- Chưa có tài liệu chính thức của Apple về cách reviewer xử lý app chỉ cho đăng nhập qua social. Phương án 1 của mục demo là suy luận từ 2.1(a) và báo cáo trên forum.
- Chưa đánh giá thiết kế account API phía IdP (scope, audience, rate limit, `recentLogin` cho bearer token). Phần này cần một research hoặc plan riêng.

## Câu hỏi chưa giải quyết

1. App chỉ phục vụ tenant chính hay cả tenant sổ? Tenant sổ không có Apple nên vướng 4.8, và cần cách chọn tenant.
2. Xoá tài khoản là ngay lập tức hay có thời gian ân hạn (ví dụ 7 ngày rồi mới xoá cứng)? Nếu có ân hạn thì app phải ghi rõ thời hạn.
3. Refresh token của client mới có theo `chat-mobile` (không trần, không chết theo phiên) không? Với app quản lý bảo mật, nên cân nhắc có trần.
4. Có cần `webcredentials:` trong AASA cho callback https không? Cần kiểm trên máy thật.

Status: DONE_WITH_CONCERNS
Summary: Đã đủ khuyến nghị xếp hạng cho review, OIDC native, APNs, Face ID và nộp app. Một số trang Apple phải dựa vào kiến thức API và forum thay vì toàn văn, và chưa có hướng dẫn chính thức về demo account cho app chỉ đăng nhập qua social.
