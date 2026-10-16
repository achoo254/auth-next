# Dùng domain riêng với hoandat-auth, Localman và Tunelo

Hướng dẫn cho người sở hữu một domain muốn người dùng của mình đăng nhập ở `auth.<domain>`,
dùng Localman ở `localman.<domain>` và Tunelo ở `tunnel.<domain>`. Mỗi domain là một
**tenant** riêng: tài khoản, phiên, token, project, mock và tunnel không lẫn với domain khác
(ADR [0006](decisions/0006-tenants-by-domain.md)). Không cần cài gì: mọi thứ chạy trên máy
chủ của hoandat.com.

## Cần chuẩn bị

- Một tài khoản ở `https://auth.hoandat.com` có liên kết Google hoặc GitHub. Danh tính
  Google/GitHub đó là **chủ** tenant, không phải "người đến trước".
- Quyền sửa DNS của domain. Domain phải dưới một hậu tố ICANN (không nhận subdomain của
  dịch vụ DNS động miễn phí); subdomain của domain mình sở hữu (`dev.example.com`) thì được.
- Một OAuth app Google hoặc GitHub của riêng domain (bước 4).
- Nếu DNS nằm trên Cloudflare: một API token (bước 5) để có chứng chỉ wildcard.

Mỗi tài khoản giữ tối đa 2 domain đã nhận; máy chủ có trần số tenant và có thể tạm không
nhận domain mới.

## 1. Bắt đầu nhận domain

Vào `https://auth.hoandat.com/claim`, nhập domain, chọn danh tính chủ, bấm **Bắt đầu nhận
domain**. Lượt nhận sống 24 giờ; trang hiện bảng bản ghi DNS cần thêm (bấm vào một ô là
chọn cả giá trị để copy).

## 2. Thêm bản ghi DNS

| Loại | Tên | Giá trị | Proxy |
|---|---|---|---|
| TXT | `_auth-claim.<domain>` | giá trị trên trang claim | — |
| A | `auth.<domain>` | IP trên trang claim | DNS only hoặc Proxied |
| A | `chat.<domain>` | như trên | DNS only hoặc Proxied |
| A | `localman.<domain>` | như trên | DNS only hoặc Proxied |
| A | `*.localman.<domain>` | như trên | DNS only hoặc Proxied |
| A | `tunnel.<domain>` | như trên | DNS only hoặc Proxied |
| A | `*.tunnel.<domain>` | như trên | DNS only hoặc Proxied |

Mỗi bản ghi A có thể trỏ thẳng về máy chủ (DNS only) hoặc bật proxy Cloudflare (Proxied, mây
cam), chế độ SSL nào của zone cũng được:

- **Flexible:** đoạn từ Cloudflare về máy chủ không mã hoá. Dùng được, nhưng Full (strict) an
  toàn hơn.
- **Full / Full (strict):** máy chủ có chứng chỉ Let's Encrypt thật cho các host này. Nếu bật
  "Always Use HTTPS" mà chưa có token Cloudflare (bước 5), lần cấp chứng chỉ đầu có thể không
  qua: thêm token, hoặc để DNS only tới khi chứng chỉ được cấp.
- `*.localman.` và `*.tunnel.` là wildcard hai cấp: gói free của Cloudflare không có chứng chỉ
  edge cho chúng. Muốn Proxied các host đó thì cần chứng chỉ edge trả phí (Advanced
  Certificate Manager); không thì để DNS only.

**Giữ bản ghi TXT sau khi nhận xong**: máy chủ kiểm lại
6 giờ một lần, TXT mất hoặc A không còn trỏ về thì sau 3 lần sai liền tenant bị tạm đình chỉ
(trang không phục vụ, không cấp token), và tự trở lại khi DNS đúng lại.

Chờ DNS lan (thường vài phút) rồi bấm **Kiểm tra DNS**. Đạt thì domain thuộc về bạn và chứng
chỉ được xếp hàng cấp.

## 3. Mở trang quản trị

Trên `https://auth.hoandat.com/claim` bấm **Mở trang quản trị** của domain. Liên kết dùng một
lần, hết hạn sau 2 phút, mở phiên quản trị 30 phút ở `https://auth.<domain>/admin`; hết phiên
thì quay lại `/claim` mở lại. Tenant chưa có cách đăng nhập nào thì domain chỉ phục vụ trang
quản trị; quá 48 giờ không thêm thì tenant bị gỡ và domain nhận lại được.

## 4. Thêm đăng nhập Google hoặc GitHub

Tạo OAuth app với callback trang quản trị hiện:

- GitHub: Settings → Developer settings → OAuth Apps → New OAuth App; Homepage
  `https://auth.<domain>`, callback `https://auth.<domain>/oauth/github/callback`.
- Google: Google Cloud → APIs & Services → Credentials → OAuth client (Web application);
  redirect `https://auth.<domain>/oauth/google/callback`; Google đòi thêm link chính sách
  quyền riêng tư `https://auth.<domain>/privacy`.

Dán client ID và client secret vào trang quản trị, **Lưu**. Có ít nhất một cách đăng nhập là
tenant hoạt động: người dùng đăng nhập và tạo tài khoản ở `https://auth.<domain>`. Secret
không bao giờ hiện lại; không gỡ được cách đăng nhập cuối cùng.

## 5. Token Cloudflare (chỉ khi DNS nằm trên Cloudflare)

Chứng chỉ của `auth.`, `chat.`, `localman.`, `tunnel.` được cấp không cần token (HTTP-01); có
token thì chúng cũng được cấp qua DNS, chạy với mọi chế độ proxy. Chứng chỉ wildcard
(`*.localman.`, `*.tunnel.`, cho mock và tunnel) cần chứng minh qua DNS:
dash.cloudflare.com → My Profile → API Tokens → **Create Token** → mẫu **Edit zone DNS**,
Zone Resources chọn zone của domain (token của tài khoản cùng quyền cũng được). Dán vào mục
**Token DNS Cloudflare**; trang thử tạo rồi xoá một bản ghi TXT trước khi lưu. Token được
niêm phong cho dịch vụ cấp chứng chỉ, không ai đọc lại được. Chứng chỉ tự gia hạn.

Thiếu token thì mock (`<secret>.localman.<domain>`) và tunnel (`<tên>.tunnel.<domain>`) không
bắt tay TLS được; các trang chính vẫn chạy.

## 6. Người dùng của domain

- **Tài khoản:** `https://auth.<domain>` (đăng nhập bằng OAuth app của bạn). Tài khoản ở đây
  tách hẳn tài khoản ở hoandat.com, kể cả khi cùng một người.
- **Localman:** `https://localman.<domain>`; mock ở `https://<secret>.localman.<domain>`; MCP ở
  `https://localman.<domain>/mcp`.
- **Tunelo:** cần CLI 1.8.0 trở lên (`npm install -g tunelo@latest`), rồi
  `tunelo login --server https://tunnel.<domain>`; tunnel có dạng `https://<tên>.tunnel.<domain>`.
  CLI giữ một phiên: đăng nhập domain khác thì phiên cũ được thay. Xem request qua tunnel:
  `tunelo watch`. Console web ở `https://tunnel.<domain>`.
- Bot Telegram (tuỳ chọn, trang quản trị): cho người dùng liên kết chat để nhận thông báo bảo
  mật; tạo bot bằng @BotFather.

## Gỡ domain

Gỡ bản ghi TXT (tenant bị đình chỉ sau 3 lần kiểm sai) hoặc nhờ người vận hành gỡ tenant:
chứng chỉ, token Cloudflare và mọi dữ liệu của tenant bị xoá, domain nhận lại được từ đầu.
