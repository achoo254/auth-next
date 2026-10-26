# auth-next

`auth-next` là IdP OpenID Connect tự host tại `auth.hoandat.com`, nơi đăng nhập chung của hệ `*-next` (Localman, Tunelo, Chat, Scribe, Miu World, Tiểu Đệ và app iOS "Tài khoản"). Một tài khoản hoandat.com dùng được cho mọi app; app không tự giữ mật khẩu hay danh tính. Tên cũ là `hoandat-auth`: process pm2 và thư mục trên server vẫn giữ tên này ([`infra/deploy.sh`](infra/deploy.sh)).

Dựng trên [`oidc-provider`](https://github.com/panva/node-oidc-provider), Express và MongoDB (phiên bản ở [`package.json`](package.json)). **App tích hợp đọc [`docs/integration-guide.md`](docs/integration-guide.md)**: đó là hợp đồng với client, README không lặp lại.

## Quyết định chính

| Quyết định | ADR |
|---|---|
| Tự host IdP bằng `oidc-provider` thay vì dịch vụ ngoài | [0001](docs/decisions/0001-own-oidc-idp.md) |
| Tài khoản, trang đăng nhập và trang `/account` render phía server, không JavaScript | [0002](docs/decisions/0002-accounts-and-login-pages.md) |
| Token exchange Localman → Tunelo, kiểm client tĩnh, outbox sự kiện audit gửi sang Localman | [0003](docs/decisions/0003-token-exchange-and-audit-outbox.md) |
| Chỉ đăng nhập bằng Google/GitHub, không mật khẩu hay mã khôi phục | [0004](docs/decisions/0004-upstream-only-sign-in.md) |
| ES256 mặc định, RS256 cho ID token của client cần | [0005](docs/decisions/0005-rs256-id-tokens.md) |
| Thêm "Đăng nhập với Apple" | [0008](docs/decisions/0008-sign-in-with-apple.md) |
| Người dùng tự xoá tài khoản | [0009](docs/decisions/0009-account-deletion.md) |
| Mật khẩu chỉ cho người duyệt App Store, tắt mặc định | [0010](docs/decisions/0010-review-only-password-sign-in.md) |
| Ghi tài khoản vào app nào để đo tăng trưởng (`client_usage`) | [0011](docs/decisions/0011-client-usage-metrics.md) |
| Đơn tenant `hoandat.com`, vẫn giữ trường `tenantId` | [0013](docs/decisions/0013-single-tenant.md) |

ADR 0006 (tenant theo domain), 0007 (tenant tự host) và 0012 (Scribe trên tenant) đã bị ADR 0013 thay thế; chỉ còn giá trị lịch sử.

Ràng buộc không suy ra được từ code:

- **Không có kênh email.** Hệ sinh thái không gửi mail; IdP không có quên mật khẩu, xác minh qua mail hay thông báo mail. Thông báo bảo mật đi qua bot Telegram (khi người dùng liên kết) và push của app "Tài khoản".
- **Không được để tài khoản mất cách đăng nhập.** Vì chỉ có Google/GitHub/Apple, khoá huỷ liên kết provider cuối cùng là yêu cầu an toàn, không phải tiện ích.
- **Một tenant, nhưng dữ liệu vẫn mang `tenantId`.** ADR 0013 chọn không migrate; mọi truy vấn vẫn lọc theo tenant để giữ cô lập dữ liệu.

## Lưu ý cho client

Hợp đồng đầy đủ ở [`docs/integration-guide.md`](docs/integration-guide.md); các điểm dễ sai nhất:

- **Endpoint lấy từ discovery** (`/.well-known/openid-configuration`), không hardcode (mục 1).
- **Refresh token dùng một lần và xoay vòng.** Dùng lại token cũ thu hồi cả grant; hai refresh song song thì một cái nhận `invalid_grant`. Client chạy nhiều tiến trình (như Tunelo CLI) **phải khoá khi refresh** và lưu token mới trước khi nhả khoá (mục 8).
- **Phiên trượt 30 ngày, trần 90 ngày** từ lúc đăng nhập; một số client thiết bị không có trần. Client nào có trần do `hasHardCap` trong [`src/oidc/sliding-grants.ts`](src/oidc/sliding-grants.ts) quyết định (mục 8).
- **Refresh token của client web gắn với phiên IdP**: đăng xuất ở IdP thì lần refresh sau nhận `invalid_grant`, kể cả khi back-channel logout không tới (mục 5, 8).
- **Xác minh access token offline** bằng JWKS đã cache, kiểm `iss`, `aud` của chính mình, `alg` và `typ`; mẫu tham chiếu: [`src/__tests__/helpers/verify-access-token.ts`](src/__tests__/helpers/verify-access-token.ts) (mục 3).
- **Token exchange** chỉ dành cho `localman-web` (mục 6). **Client MCP** đăng ký động qua `/reg` (mục 9). App iOS "Tài khoản" dùng `/api/account` (mục 13).
- Revocation và introspection: client chỉ thao tác trên token của chính nó, trừ các client tin cậy khai ở [`src/oidc/clients.ts`](src/oidc/clients.ts).

Thêm app mới: khai client tĩnh ở [`src/oidc/clients.ts`](src/oidc/clients.ts) (hoặc file client riêng của app trong `src/oidc/`), cập nhật trang `/apps` ([`src/app-directory/`](src/app-directory/)) và mục 2 của integration guide; [`scripts/seed-clients.ts`](scripts/seed-clients.ts) kiểm client với env hiện tại.

## Bắt đầu

Yêu cầu: Node và pnpm theo `engines`/`packageManager` trong [`package.json`](package.json); MongoDB chạy replica set, hoặc Docker.

```bash
pnpm install
pnpm generate-key            # tạo khoá ký vào secrets/
cp .env.example .env         # điền secret theo chú thích trong file
pnpm dev
```

Hoặc chạy cả MongoDB lẫn IdP bằng [`docker-compose.yml`](docker-compose.yml). Danh sách lệnh ở `scripts` của [`package.json`](package.json); cổng kiểm tra trước khi báo xong và giới hạn chạy test trên máy dev ở [`CLAUDE.md`](CLAUDE.md).

## Cấu hình và vận hành

- Biến môi trường: [`.env.example`](.env.example) (có chú thích), schema ở [`src/config/`](src/config/). Ở production process từ chối khởi động khi URL không phải https công khai hoặc `TRUST_PROXY` còn mặc định. `TRUST_PROXY` phải ghi đúng địa chỉ của reverse proxy, không tin cả một dải mạng riêng, vì container nào trong dải đó cũng giả được IP client.
- Deploy, xoay khoá ký, client theo từng app, rollback: [`docs/deployment-guide.md`](docs/deployment-guide.md); script ở [`infra/`](infra/).
- Bật "Đăng nhập với Apple": [`docs/sign-in-with-apple.md`](docs/sign-in-with-apple.md).

## Đi đâu trong code

| Chỗ | Vai trò |
|---|---|
| [`src/server.ts`](src/server.ts), [`src/app.ts`](src/app.ts) | Entry point và dựng Express |
| [`src/oidc/`](src/oidc/) | Cấu hình provider, client, resource/audience, DCR, token exchange, phiên trượt, JWKS |
| [`src/interactions/`](src/interactions/), [`src/account-portal/`](src/account-portal/) | Trang đăng nhập/đăng ký/consent/thiết bị và trang `/account` |
| [`src/accounts/`](src/accounts/) | Tài khoản, luật liên kết, Google/GitHub/Apple |
| [`src/account-api/`](src/account-api/), [`src/push/`](src/push/), [`ios/`](ios/) | API và push cho app iOS "Tài khoản" |
| [`src/audit/`](src/audit/), [`src/usage/`](src/usage/) | Outbox sự kiện audit; ghi lượt vào app cho `growth-report` |
| [`src/tenants/`](src/tenants/) | Tenant duy nhất từ env và lọc `tenantId` ở tầng dữ liệu |
| [`src/telegram/`](src/telegram/), [`src/i18n/`](src/i18n/), [`src/ui/`](src/ui/) | Bot thông báo, từ điển ba ngôn ngữ, template HTML tự escape |
| [`scripts/`](scripts/) | Sinh khoá, kiểm client, báo cáo tăng trưởng, kiểm token màu |
| [`src/__tests__/`](src/__tests__/), [`e2e/`](e2e/) | Test luồng trên MongoDB thật; Playwright trên server thật |
