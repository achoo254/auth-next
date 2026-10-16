import type { enGuide } from "../en/guide.js";
import type { Translation } from "../translation.js";

export const viGuide: Translation<typeof enGuide> = {
	"guide.title": "Dùng domain của riêng bạn",
	"guide.subtitle":
		"Chạy đăng nhập, Chat, Localman và Tunelo trên domain bạn sở hữu, với tài khoản riêng.",
	"guide.intro":
		"Thiết lập xong, người dùng của bạn đăng nhập ở auth.<domain>, dùng Chat ở chat.<domain>, Localman ở localman.<domain> và Tunelo ở tunnel.<domain>. Không cần cài gì: mọi thứ chạy trên máy chủ của {brandDomain}. Tài khoản, phiên, project và tunnel của domain bạn không bao giờ lẫn với domain khác.",
	"guide.figure": "Hình {number}.",
	"guide.prepare.title": "Cần chuẩn bị",
	"guide.prepare.account":
		"Một tài khoản ở auth.{brandDomain} đã liên kết Google hoặc GitHub. Danh tính Google hoặc GitHub đó là chủ của domain.",
	"guide.prepare.dns":
		"Quyền sửa DNS của domain. Subdomain của domain bạn sở hữu (dev.example.com) cũng được.",
	"guide.prepare.oauth":
		"Một tài khoản Google Cloud hoặc GitHub để tạo app đăng nhập cho domain (bước 5).",
	"guide.prepare.cloudflare":
		"Nên có: DNS nằm trên Cloudflare, kèm một API token (bước 6). Thiếu token thì mock và tunnel trên subdomain không có chứng chỉ.",
	"guide.claim.title": "1. Bắt đầu nhận domain",
	"guide.claim.body":
		"Mở {claim}, nhập domain và chọn danh tính chủ. Lượt nhận sống 24 giờ.",
	"guide.claim.figure": "Bắt đầu nhận domain: domain và chủ của nó.",
	"guide.dns.title": "2. Thêm bản ghi DNS",
	"guide.dns.body":
		"Trang liệt kê một bản ghi TXT và sáu bản ghi A. Bấm vào tên hoặc giá trị để chọn cả ô, rồi copy sang nhà cung cấp DNS.",
	"guide.dns.figure": "Các bản ghi cần thêm, với giá trị của bạn.",
	"guide.dns.dnsOnly":
		"Chỉ DNS (khuyên dùng): bản ghi A trỏ thẳng về máy chủ. Mọi thứ đều chạy, kể cả kết nối thời gian thực của Chat và mọi subdomain.",
	"guide.dns.proxied":
		"Bật proxy Cloudflare (mây cam) cũng được, với SSL của zone để Full (strict). Máy chủ có chứng chỉ thật cho các host này.",
	"guide.dns.flexible":
		"Tránh Flexible: khi đó Cloudflare cắt kết nối thời gian thực của Chat nên tin nhắn không đồng bộ. Nếu zone buộc phải để Flexible, thêm một Configuration Rule đặt SSL Full (strict) cho chat.<domain>.",
	"guide.dns.wildcard":
		"*.localman. và *.tunnel. là wildcard hai cấp: gói free của Cloudflare không có chứng chỉ edge cho chúng. Để Chỉ DNS, trừ khi bạn trả phí cho chứng chỉ đó.",
	"guide.dns.keepTxt":
		"Giữ bản ghi TXT sau khi nhận xong: máy chủ kiểm lại 6 giờ một lần, domain sai 3 lần liền bị tạm đình chỉ tới khi DNS đúng lại.",
	"guide.verify.title": "3. Kiểm tra DNS",
	"guide.verify.body":
		"Đợi vài phút cho DNS lan rồi bấm Kiểm tra DNS. Bản ghi nào chưa trỏ về máy chủ sẽ được đánh dấu; sửa rồi kiểm tra lại.",
	"guide.verify.wrongFigure":
		"Một bản ghi chưa đúng: chat.<domain> được đánh dấu.",
	"guide.verify.done":
		"Khi mọi bản ghi đều đúng, domain thuộc về bạn và chứng chỉ được cấp trong vài phút. Domain hiện trong mục Domain của bạn.",
	"guide.verify.doneFigure": "Domain đã nhận, sẵn sàng mở trang quản trị.",
	"guide.admin.title": "4. Mở trang quản trị",
	"guide.admin.body":
		"Bấm Mở trang quản trị. Liên kết dùng một lần, trong 2 phút, mở phiên quản trị 30 phút ở auth.<domain>/admin; hết phiên thì mở lại từ {claim}.",
	"guide.admin.deadline":
		"Thêm cách đăng nhập trong 48 giờ: quá hạn mà chưa có thì domain bị gỡ và nhận lại được từ đầu.",
	"guide.admin.figure":
		"Trang quản trị: trạng thái, địa chỉ và chứng chỉ ở trên cùng.",
	"guide.signin.title": "5. Thêm đăng nhập Google hoặc GitHub",
	"guide.signin.body":
		"Người dùng đăng nhập bằng một app Google hoặc GitHub của riêng domain bạn. Một cái là đủ; thêm cả hai cũng được.",
	"guide.signin.github":
		"GitHub: Settings, Developer settings, OAuth Apps, New OAuth App. Homepage URL https://auth.<domain>, redirect URI https://auth.<domain>/oauth/github/callback. Sau đó tạo client secret.",
	"guide.signin.googleBranding":
		"Google: trong Google Cloud, mở Google Auth Platform, Branding. Điền trang chủ https://auth.<domain>, chính sách quyền riêng tư https://auth.<domain>/privacy (trang này có sẵn) và thêm domain của bạn vào authorized domains.",
	"guide.signin.googleBrandingFigure":
		"Google Auth Platform, Branding: trang chủ, chính sách quyền riêng tư và authorized domain.",
	"guide.signin.googleClient":
		"Rồi Clients, Create client: loại Web application, authorized redirect URI https://auth.<domain>/oauth/google/callback.",
	"guide.signin.googleClientFigure":
		"Create OAuth client ID: Web application và redirect URI của nó.",
	"guide.signin.paste":
		"Dán client ID và client secret vào trang quản trị rồi lưu. Domain hoạt động ngay khi có một cách đăng nhập. Secret không bao giờ hiện lại, và không gỡ được cách đăng nhập cuối cùng.",
	"guide.signin.pasteFigure":
		"Trang quản trị hiện đúng callback URL cần đăng ký.",
	"guide.token.title": "6. Token Cloudflare (DNS trên Cloudflare)",
	"guide.token.body":
		"Mock (<secret>.localman.<domain>) và tunnel (<tên>.tunnel.<domain>) cần chứng chỉ wildcard, chứng minh qua DNS. Ở dash.cloudflare.com: My Profile, API Tokens, Create Token, mẫu Edit zone DNS, chọn zone của domain. Dán vào trang quản trị; trang thử tạo rồi xoá một bản ghi TXT, rồi niêm phong token cho dịch vụ cấp chứng chỉ.",
	"guide.token.figure": "Chỗ dán token Cloudflare.",
	"guide.token.without":
		"Thiếu token thì các trang chính vẫn chạy; mock và tunnel trên subdomain thì không.",
	"guide.users.title": "7. Người dùng của domain",
	"guide.users.accounts":
		"Tài khoản: https://auth.<domain>. Tách hẳn tài khoản ở {brandDomain}, kể cả khi cùng một người.",
	"guide.users.chat": "Chat: https://chat.<domain>.",
	"guide.users.localman":
		"Localman: https://localman.<domain>; mock ở https://<secret>.localman.<domain>; MCP ở https://localman.<domain>/mcp.",
	"guide.users.tunelo":
		"Tunelo: CLI 1.8.0 trở lên (npm install -g tunelo@latest), rồi tunelo login --server https://tunnel.<domain>.",
	"guide.keep.title": "Giữ hoặc gỡ domain",
	"guide.keep.body":
		"Domain còn là của bạn khi bản ghi TXT còn và các bản ghi trỏ về máy chủ. Muốn gỡ: xoá bản ghi TXT hoặc nhờ người vận hành; chứng chỉ, token và mọi dữ liệu của domain bị xoá, domain nhận lại được từ đầu.",
	"guide.dns.cloudflareRecordFigure":
		"Cloudflare, DNS, Add record: bản ghi A để DNS only (mây xám).",
	"guide.dns.sslModeFigure":
		"Cloudflare, SSL/TLS: với host bật proxy, chọn Full (Strict) rồi Save, không chọn Flexible.",
	"guide.signin.githubFigure":
		"GitHub, Register a new OAuth app: trang chủ và redirect URI.",
	"guide.token.templateFigure":
		"Cloudflare, API Tokens, Create Token: dùng mẫu Edit zone DNS.",
	"guide.token.createFigure":
		"Quyền Zone DNS Edit, giới hạn ở domain của bạn trong Zone Resources.",
	"claim.guideLink": "Hướng dẫn từng bước có ảnh chụp màn hình",
};
