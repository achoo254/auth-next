# Bật "Đăng nhập với Apple" cho auth.hoandat.com

Code đã có sẵn (ADR [0008](decisions/0008-sign-in-with-apple.md)); nút Apple tự hiện khi IdP có đủ cấu hình. Làm các bước dưới **sau khi Apple duyệt tài khoản Apple Developer** (gói trả phí). Mọi thao tác trên server là thao tác ghi production: chỉ làm khi chủ sở hữu yêu cầu cho chính lần đó (skill `hoandat-auth-ops-prod`).

Giá trị dùng trong tài liệu (đổi nếu chọn khác):

| Thứ | Giá trị |
|---|---|
| Primary App ID (app iPhone Scribe) | `com.hoandat.scribe` |
| Services ID (`client_id` của luồng web) | `com.hoandat.auth.signin` |
| Domain | `auth.hoandat.com` |
| Return URL | `https://auth.hoandat.com/oauth/apple/callback` |
| Server-to-server notification endpoint | `https://auth.hoandat.com/oauth/apple/notifications` |
| File khoá trên server | `/var/www/hoandat-auth/secrets/apple-signin-key.p8` |

## 1. App ID có Sign in with Apple

[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers → App IDs → `com.hoandat.scribe` (tạo nếu chưa có: App, Bundle ID explicit đúng bundle của app Scribe).

1. Bật capability **Sign in with Apple** → Edit → **Enable as a primary App ID**.
2. Cùng màn hình đó, mục **Server-to-Server Notification Endpoint**: nhập `https://auth.hoandat.com/oauth/apple/notifications`.
3. Save. Provisioning profile của app sẽ có entitlement mới: build app lần sau tạo lại profile (app không cần code native nào, xem mục 7).

Apple yêu cầu website dùng Sign in with Apple phải gắn với một app trên App Store có Sign in with Apple: đó là Scribe. Tài liệu: [Configuring your environment for Sign in with Apple](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple), [Group apps for Sign in with Apple](https://developer.apple.com/help/account/configure-app-capabilities/group-apps-for-sign-in-with-apple).

## 2. Services ID cho IdP

Identifiers → **+** → **Services IDs** → Description `hoandat.com` (tên người dùng thấy trong mục Đăng nhập bằng Apple trên iPhone), Identifier `com.hoandat.auth.signin` → Register. Mở lại nó:

1. Tick **Sign in with Apple** → Configure.
2. Primary App ID: `com.hoandat.scribe`.
3. Domains and Subdomains: `auth.hoandat.com` (không có `https://`).
4. Return URLs: `https://auth.hoandat.com/oauth/apple/callback` (đúng từng ký tự, không `/` cuối).
5. Next → Done → Continue → Save.

Nếu portal hiện bước **Download/Verify** cho domain (tệp `apple-developer-domain-association.txt`), IdP chưa phục vụ tệp đó: đặt tệp vào server và thêm vào `/etc/nginx/conf.d/auth.hoandat.com.conf` một `location = /.well-known/apple-developer-domain-association.txt { alias <đường dẫn tệp>; }`, `nginx -t`, reload, rồi bấm Verify. Portal hiện tại thường không còn đòi bước này. Tài liệu: [Configure Sign in with Apple for the web](https://developer.apple.com/help/account/configure-app-capabilities/configure-sign-in-with-apple-for-the-web).

## 3. Khoá Sign in with Apple (.p8)

Keys → **+** → tên `hoandat.com Sign in with Apple` → tick **Sign in with Apple** → Configure → Primary App ID `com.hoandat.scribe` → Save → Continue → Register → **Download** (chỉ tải được một lần) → ghi lại **Key ID** (10 ký tự). **Team ID** ở góc phải trên của portal hoặc trang Membership.

Tài liệu: [Create a Sign in with Apple private key](https://developer.apple.com/help/account/configure-app-capabilities/create-a-sign-in-with-apple-private-key), [Get a key identifier](https://developer.apple.com/help/account/manage-keys/get-a-key-identifier). Mỗi primary App ID có tối đa hai khoá; khoá lộ thì tạo khoá mới, đổi `APPLE_KEY_ID` + file, restart, rồi revoke khoá cũ.

## 4. Đặt khoá và biến môi trường trên server

Không gửi file `.p8` qua chat hay commit. Chép thẳng từ máy chủ sở hữu (thư mục `secrets/` không bị `infra/deploy.sh` đồng bộ, nên deploy không ghi đè hay xoá nó):

```bash
scp -P <SSH_PORT> AuthKey_<KEYID>.p8 <user>@<SERVER_65_IP>:/var/www/hoandat-auth/secrets/apple-signin-key.p8
ssh -p <SSH_PORT> <user>@<SERVER_65_IP> 'chmod 600 /var/www/hoandat-auth/secrets/apple-signin-key.p8'
```

Thêm vào `/var/www/hoandat-auth/.env` (mode 600):

```dotenv
APPLE_TEAM_ID=<Team ID>
APPLE_SERVICES_ID=com.hoandat.auth.signin
APPLE_KEY_ID=<Key ID>
APPLE_PRIVATE_KEY_PATH=/var/www/hoandat-auth/secrets/apple-signin-key.p8
# aud của server-to-server notification là bundle ID của primary App ID
APPLE_PRIMARY_APP_ID=com.hoandat.scribe
```

Bốn biến đầu đi cùng nhau: thiếu một biến, sai dạng ID, hay file không phải khoá EC P-256 thì IdP không khởi động và báo đúng tên biến (không in nội dung). Vì vậy restart rồi kiểm ngay: trong `/var/www/hoandat-auth` chạy `pm2 startOrReload infra/ecosystem.config.cjs --update-env` (chỉ process `hoandat-auth`; `.env` được đọc qua `--env-file` lúc khởi động), `curl -fsS https://auth.hoandat.com/healthz`, `pm2 logs hoandat-auth --lines 50 --nostream`. Lỗi thì xoá năm dòng trên và restart để quay lại như cũ. Chép bản sao `.p8` và `.env` vào `ENV production/auth-hoandat/server/` như các secret khác (deployment-guide, mục secret).

Bản deploy phải chứa commit có ADR 0008. Lần khởi động đầu tạo thêm chỉ mục `tenant_providers_apple` trên `accounts` (nhẹ).

## 5. Private Email Relay

Người dùng chọn "Ẩn email" thì IdP nhận địa chỉ dạng `…@privaterelay.appleid.com`. IdP **không gửi email** (CLAUDE.md), nên không cần đăng ký gì. Nếu một app (Localman, Scribe…) muốn gửi mail tới các địa chỉ đó: Certificates, Identifiers & Profiles → Services → **Sign in with Apple for Email Communication** → Configure → thêm domain hoặc địa chỉ gửi, domain phải có SPF (và nên có DKIM). Địa chỉ chuyển tiếp giống nhau cho mọi app cùng team, giới hạn 100 mail/ngày. Tài liệu: [Configure Private Email Relay Service](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service), [Communicating using the private email relay service](https://developer.apple.com/documentation/signinwithapple/communicating-using-the-private-email-relay-service).

## 6. Kiểm thử sau khi bật

1. Cửa sổ ẩn danh → `https://localman.hoandat.com` (hoặc app Scribe) → đăng nhập: nút "Đăng nhập với Apple" đứng đầu.
2. Đăng nhập bằng một Apple ID chưa từng dùng, chọn **Ẩn email** → trang chọn username hiện địa chỉ `@privaterelay.appleid.com` → tạo tài khoản → quay về app.
3. `https://auth.hoandat.com/account` → "Cách đăng nhập": Apple "Đã liên kết (…@privaterelay.appleid.com)".
4. Đăng xuất, đăng nhập lại bằng Apple: vào thẳng, không hỏi username (Apple không gửi lại tên/email; IdP nhận theo `sub`).
5. Liên kết Google ở `/account`, rồi **Huỷ liên kết Apple** → Apple ID đó biến mất khỏi Cài đặt → Apple ID → Đăng nhập bằng Apple (IdP đã gọi revoke). Log: không có dòng `Revocation at the provider failed`.
6. Thông báo: ở iPhone, Cài đặt → Apple ID → Đăng nhập bằng Apple → hoandat.com → Ngừng sử dụng Apple ID. Log có `Apple account event` với `type: consent-revoked`. Có dòng `Apple notification rejected` thì kiểm `APPLE_PRIMARY_APP_ID` (aud của thông báo là bundle ID của primary App ID).
7. App iPhone Scribe: đăng nhập qua `ASWebAuthenticationSession` thấy cùng nút Apple. Đó là bằng chứng cho Guideline 4.8 khi nộp review; nêu trong App Review notes "Sign in with Apple is offered on our sign-in page (web flow in ASWebAuthenticationSession)".

## 7. Ghi chú

- **Tài khoản đã có**: ai đã có tài khoản Google/GitHub mà dùng Apple với email ẩn sẽ ra tài khoản mới (email chuyển tiếp không trùng). Muốn dùng chung: đăng nhập bằng Google/GitHub rồi bấm "Liên kết Apple" ở `/account`. Apple chia sẻ email thật trùng email đã xác minh của tài khoản cũ thì IdP tự liên kết.
- **App native**: Guideline 4.8 chấp nhận Sign in with Apple qua web; Scribe không cần AuthenticationServices. Nút Apple native trong app cần ADR mới (ID token của app có `aud` là bundle ID, IdP không nhận trực tiếp).
- **Xoá tài khoản**: IdP chưa có tính năng xoá (chính sách: liên hệ email). Khi xoá tay một tài khoản có Apple, huỷ liên kết Apple ở `/account` trước (để IdP gọi revoke) hoặc thêm bước revoke vào tính năng xoá khi làm (Guideline 5.1.1(v)).
- **Tenant khác** (`auth.<domain>`) không có Apple (ADR 0008 mục 1).
- Tham chiếu API: [Sign in with Apple REST API](https://developer.apple.com/documentation/signinwithapplerestapi), [Creating a client secret](https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret), [Processing changes for Sign in with Apple accounts](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts), [Displaying Sign in with Apple buttons on the web](https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web), [Human Interface Guidelines: Sign in with Apple](https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple).
