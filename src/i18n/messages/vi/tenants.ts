import type { enTenants } from "../en/tenants.js";
import type { Translation } from "../translation.js";

export const viTenants: Translation<typeof enTenants> = {
	"claim.title": "Dùng domain của riêng bạn",
	"claim.lead":
		"Chạy đăng nhập {brand}, Chat, Localman và Tunelo trên domain bạn sở hữu: auth., chat., localman. và tunnel. dưới domain đó, với tài khoản riêng.",
	"claim.unavailable": "Máy chủ này chưa mở nhận domain.",
	"claim.noIdentity":
		"Hãy liên kết một tài khoản Google hoặc GitHub với tài khoản của bạn trước: chủ của domain là tài khoản đó.",
	"claim.form.domain": "Domain",
	"claim.form.domainHelp": "Ví dụ example.com hoặc dev.example.com.",
	"claim.hosting.label": "Chạy ở đâu",
	"claim.hosting.hoandat": "Trên máy chủ của {brand}",
	"claim.hosting.hoandatHelp":
		"Không cần cài gì. Dữ liệu nằm trên máy chủ của {brand}, tách riêng theo domain.",
	"claim.hosting.self": "Trên máy chủ của bạn",
	"claim.hosting.selfHelp":
		"{brand} chỉ xác minh domain và cấp gói cài đặt. Sau đó mọi request và dữ liệu nằm trên máy chủ của bạn; bạn tự lo backup, cập nhật và bảo mật.",
	"claim.form.owner": "Chủ sở hữu",
	"claim.form.ownerOption": "Tài khoản {provider} {name}",
	"claim.form.submit": "Bắt đầu nhận domain",
	"claim.pending.title": "Đang chờ DNS: {domain}",
	"claim.pending.lead":
		"Thêm các bản ghi này ở nhà cung cấp DNS rồi bấm kiểm tra. Chỉ DNS là đơn giản nhất và mọi thứ đều chạy. Bật proxy Cloudflare cũng được nếu SSL của zone để Full (strict); Flexible làm hỏng kết nối thời gian thực của Chat.",
	"claim.pending.leadSelf":
		"Thêm bản ghi TXT này ở nhà cung cấp DNS rồi bấm kiểm tra. Các host của domain trỏ về máy chủ của bạn, không trỏ về đây.",
	"claim.records.hint":
		"Bấm vào tên hoặc giá trị để chọn cả ô, rồi copy sang nhà cung cấp DNS.",
	"claim.records.type": "Loại",
	"claim.records.name": "Tên",
	"claim.records.content": "Giá trị",
	"claim.records.proxy": "Proxy",
	"claim.records.wrong": "Chưa đúng",
	"claim.records.proxyChoice": "Chỉ DNS (khuyên dùng)",
	"claim.pending.expires": "Lượt nhận hết hạn lúc {date}.",
	"claim.pending.verify": "Kiểm tra DNS",
	"claim.tenants.title": "Domain của bạn",
	"claim.tenants.claimed": "Đã nhận: hãy thêm cách đăng nhập",
	"claim.tenants.active": "Đang hoạt động",
	"claim.tenants.suspended": "Tạm đình chỉ",
	"claim.tenants.enrolling": "Đã xác minh: chờ bản cài trên máy chủ của bạn",
	"claim.tenants.selfHosted": "Chạy trên máy chủ của bạn",
	"claim.tenants.admin": "Mở trang quản trị",
	"claim.notice.started":
		"Đã bắt đầu nhận domain. Hãy thêm các bản ghi DNS bên dưới.",
	"claim.notice.verified":
		"Đã nhận domain. Mở trang quản trị để thêm đăng nhập bằng Google hoặc GitHub.",
	"claim.notice.verifiedSelf":
		"Đã xác minh domain. Bước tiếp theo là cài đặt trên máy chủ của bạn.",
	"claim.error.invalidDomain": "Đây không phải domain có thể nhận ở đây.",
	"claim.error.taken":
		"Domain này, hoặc một domain cha hay con của nó, đã được dùng.",
	"claim.error.tooManyPending":
		"Bạn đang có lượt nhận chờ DNS. Hoàn tất một lượt hoặc đợi nó hết hạn trước.",
	"claim.error.tooManyTenants":
		"Tài khoản của bạn đã giữ số domain tối đa được phép ở đây.",
	"claim.error.capacity":
		"Máy chủ chưa nhận thêm domain lúc này. Hãy thử lại sau.",
	"claim.error.notFound": "Lượt nhận này đã hết hạn hoặc không phải của bạn.",
	"claim.error.dnsTxt":
		"Không thấy bản ghi TXT hoặc giá trị khác. Thay đổi DNS có thể mất vài phút.",
	"claim.error.dnsAddress":
		"Các bản ghi đánh dấu “Chưa đúng” chưa trỏ tới {ip} (Chỉ DNS) hoặc qua proxy Cloudflare. Sửa rồi kiểm tra lại; thay đổi DNS có thể mất vài phút.",
	"claim.error.dnsUnreachable":
		"Chưa kiểm được DNS lúc này. Hãy thử lại sau một phút.",
	"admin.title": "Quản trị",
	"admin.lead": "Cấu hình của {domain}. Chỉ chủ domain mở được trang này.",
	"admin.signedOut":
		"Hãy mở trang này từ {link}, khi đã đăng nhập bằng tài khoản đã nhận domain.",
	"admin.status.claimed":
		"Chưa hoạt động: hãy thêm Google hoặc GitHub bên dưới. Trước đó không ai đăng nhập được ở đây.",
	"admin.status.active": "Đang hoạt động: người dùng đăng nhập tại {issuer}.",
	"admin.hosts.title": "Địa chỉ",
	"admin.hosts.help":
		"Bản ghi A của các địa chỉ này để Chỉ DNS (khuyên dùng) hoặc bật proxy Cloudflare. Khi bật proxy, SSL phải là Full (strict): Flexible làm hỏng kết nối thời gian thực của Chat. Bật proxy cho subdomain của *.localman. và *.tunnel. còn cần chứng chỉ edge của Cloudflare phủ wildcard hai cấp (gói trả phí).",
	"admin.certificate.pending": "Chứng chỉ: đang cấp.",
	"admin.certificate.issued": "Chứng chỉ: đã cấp lúc {date}.",
	"admin.certificate.failed":
		"Chứng chỉ: lần cấp gần nhất lỗi ({error}); thử lại lúc {date}.",
	"admin.name.title": "Tên hiển thị",
	"admin.name.help": "Hiện trên mọi trang đăng nhập và trang tài khoản.",
	"admin.oauth.title": "Đăng nhập bằng {provider}",
	"admin.oauth.help":
		"Tạo một OAuth app ở {provider} với callback URL này: {callback}",
	"admin.oauth.googlePrivacy":
		"Google còn yêu cầu URL chính sách quyền riêng tư: {url}",
	"admin.oauth.clientId": "Client ID",
	"admin.oauth.clientSecret": "Client secret",
	"admin.oauth.configured": "Đã cấu hình, client ID {clientId}.",
	"admin.oauth.remove": "Gỡ",
	"admin.dns.title": "Token DNS Cloudflare",
	"admin.dns.help":
		"Chỉ cần khi DNS của {domain} nằm trên Cloudflare: chứng chỉ wildcard (*.localman., *.tunnel.) được cấp qua DNS. Tạo token ở dash.cloudflare.com → My Profile → API Tokens → Create Token → mẫu “Edit zone DNS”, mục Zone Resources chọn zone của {domain} (token của tài khoản cùng quyền cũng được). Token được niêm phong cho dịch vụ cấp chứng chỉ; không ai đọc lại được.",
	"admin.dns.token": "API token",
	"admin.dns.configured": "Đã lưu một token.",
	"admin.dns.unavailable": "Máy chủ này chưa lưu được token DNS.",
	"admin.telegram.title": "Bot Telegram (tuỳ chọn)",
	"admin.telegram.help":
		"Cho người dùng liên kết chat để nhận thông báo bảo mật. Tạo bot bằng @BotFather.",
	"admin.telegram.token": "Bot token",
	"admin.telegram.username": "Username của bot",
	"admin.telegram.configured": "Đã kết nối @{username}.",
	"admin.save": "Lưu",
	"admin.signOut": "Rời trang quản trị",
	"admin.result.saved": "Đã lưu.",
	"admin.result.invalid": "Hãy kiểm tra lại giá trị rồi thử lại.",
	"admin.result.lastProvider":
		"Phải giữ ít nhất một cách đăng nhập: thiếu nó thì không ai đăng nhập được.",
	"admin.result.cloudflareInvalid": "Cloudflare từ chối token này.",
	"admin.result.cloudflareNoZone": "Token này không thấy zone của {domain}.",
	"admin.result.cloudflareNoDnsEdit":
		"Token này không sửa được bản ghi DNS của {domain}.",
	"admin.result.cloudflareUnreachable":
		"Không kết nối được Cloudflare. Hãy thử lại.",
	"admin.result.dnsUnavailable": "Máy chủ này chưa lưu được token DNS.",
	"admin.result.telegramRefused": "Telegram từ chối bot token này.",
	"inactive.title": "Chưa thiết lập",
	"inactive.body": "Đăng nhập tại {host} chưa được thiết lập.",
};
