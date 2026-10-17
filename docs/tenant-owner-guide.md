# Dùng domain riêng với hoandat-auth, Localman và Tunelo

Hướng dẫn cho người sở hữu một domain muốn người dùng của mình đăng nhập ở `auth.<domain>`,
dùng Localman ở `localman.<domain>` và Tunelo ở `tunnel.<domain>`. Mỗi domain là một
**tenant** riêng: tài khoản, phiên, token, project, mock và tunnel không lẫn với domain khác
(ADR [0006](decisions/0006-tenants-by-domain.md)). Không cần cài gì: mọi thứ chạy trên máy
chủ của hoandat.com.

Bản cho khách, có ảnh chụp màn hình từng bước và đủ ba ngôn ngữ, ở trang công khai
`https://auth.hoandat.com/guide/domain` (`src/guide/`). Đổi các bước ở đây thì sửa cả trang đó.

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

- **Flexible:** đoạn từ Cloudflare về máy chủ không mã hoá. Trang web và đăng nhập chạy được,
  nhưng **WebSocket không tin được**: Cloudflare cắt kết nối khi frame từ 8 byte trở lên (đo
  16/10/2026), nên app dùng WebSocket như chat không đồng bộ được. Host nào cần WebSocket thì
  đặt Full (strict) cho riêng host đó bằng Configuration Rule của Cloudflare (Rules →
  Configuration Rules, điều kiện `Hostname equals chat.<domain>`, SSL: Full (strict)); gói free
  cũng có. Full (strict) cũng an toàn hơn.
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

## Chạy trên máy chủ của bạn (ADR 0007)

Chỉ có khi `/claim` có lựa chọn "Trên máy chủ của bạn" (`SELF_HOSTED_CLAIMS`); trang `/guide/domain` cũng chỉ hiện mục này khi đó.

- Chọn "Trên máy chủ của bạn" ở bước 1: chỉ thêm bản ghi TXT, các host trỏ về máy của owner. Xác minh xong thì tải gói cài đặt (hạn 24 giờ) và cài theo [`self-hosted-install.md`](self-hosted-install.md). Bản cài đổi gói với gateway một lần, sau đó không gì đi qua hoandat.com.
- Cần máy Linux có Docker Compose, IPv4 công khai, cổng 80, 443 và dải TCP của Tunelo, khoảng 4 GB RAM trống; DNS trên Cloudflare kèm API token; OAuth app Google/GitHub riêng và widget Turnstile cho `localman.<domain>`.
- hoandat.com không backup, cập nhật, vá hay giám sát bản cài. Giữ bản ghi TXT.
- Chuyển domain đang chạy ở đây: bấm "Chuyển sang máy chủ của bạn" (domain ngừng phục vụ ở đây ngay, dữ liệu giữ; "Huỷ chuyển" cho chạy lại), cài gói nhưng chưa trỏ bản ghi A, gửi khoá chuyển công khai cho người vận hành, nhập dữ liệu, rồi trỏ bản ghi A. Chi tiết: mục "Chuyển tenant đang chạy trên hoandat sang đây" của `self-hosted-install.md`.

## Gỡ domain

Gỡ bản ghi TXT (tenant bị đình chỉ sau 3 lần kiểm sai) hoặc nhờ người vận hành gỡ tenant:
chứng chỉ, token Cloudflare và mọi dữ liệu của tenant bị xoá, domain nhận lại được từ đầu.
