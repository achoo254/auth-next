import type { enPrivacy } from "../en/privacy.js";
import type { Translation } from "../translation.js";

export const viPrivacy: Translation<typeof enPrivacy> = {
	"privacy.title": "Chính sách quyền riêng tư",
	"privacy.subtitle":
		"Áp dụng cho dịch vụ đăng nhập auth.{brandDomain}. Cập nhật ngày 24/10/2026.",
	"privacy.stored.title": "Dữ liệu được lưu",
	"privacy.stored.profile":
		"Tên đăng nhập, địa chỉ email, tên hiển thị và ảnh đại diện.",
	"privacy.stored.noPassword":
		"Dịch vụ không dùng mật khẩu. Tài khoản tạo trước khi bỏ mật khẩu có thể vẫn còn bản băm argon2id của mật khẩu và mã khôi phục cũ; chúng không còn được dùng để đăng nhập.",
	"privacy.stored.providers":
		"Khi bạn đăng nhập bằng Google, GitHub hoặc Apple: mã định danh tài khoản ở nhà cung cấp, email đã xác minh, tên và ảnh đại diện mà nhà cung cấp trả về. Với Apple, email có thể là địa chỉ chuyển tiếp riêng tư do bạn chọn chia sẻ, và một mã được giữ lại chỉ để thu hồi liên kết ở Apple khi bạn gỡ nó.",
	"privacy.stored.telegram":
		"Khi bạn liên kết Telegram: mã chat và tên người dùng Telegram.",
	"privacy.stored.sessions":
		"Phiên đăng nhập, thiết bị và ứng dụng bạn đã cấp quyền, kèm thời điểm sử dụng.",
	"privacy.stored.appUsage":
		"Lần đăng nhập vào từng ứng dụng (mã ứng dụng, thời điểm, đăng nhập mới hay dùng phiên sẵn có), không kèm địa chỉ IP hay trình duyệt; giữ 400 ngày.",
	"privacy.stored.securityLog":
		"Nhật ký bảo mật (đăng nhập, liên kết hoặc gỡ phương thức đăng nhập, thu hồi phiên và quyền) gồm địa chỉ IP và trình duyệt; IP và trình duyệt của sự kiện chưa gửi đi bị xoá sau 30 ngày.",
	"privacy.purpose.title": "Mục đích sử dụng",
	"privacy.purpose.body":
		"Dữ liệu chỉ dùng để xác thực bạn, giữ phiên đăng nhập, khôi phục tài khoản, phát hiện truy cập bất thường và thống kê tổng hợp số người dùng theo ứng dụng. Dịch vụ không gửi email, không hiển thị quảng cáo, không bán và không chia sẻ dữ liệu hay số liệu thống kê này.",
	"privacy.sharing.title": "Chia sẻ",
	"privacy.sharing.body":
		"Thông tin hồ sơ chỉ được cấp cho các ứng dụng do cùng chủ sở hữu vận hành (các ứng dụng của {brandDomain}) hoặc ứng dụng bạn đã đồng ý cấp quyền, trong phạm vi bạn đồng ý. Không chia sẻ cho bên thứ ba nào khác.",
	"privacy.rights.title": "Quyền của bạn",
	"privacy.rights.body":
		"Tại trang {account}, bạn xem và sửa hồ sơ, gỡ liên kết Google, GitHub, Apple hoặc Telegram, thu hồi phiên và ứng dụng đã cấp quyền.",
	"privacy.rights.deleteHere":
		"Bạn tự xoá tài khoản tại trang {account} (mục Xoá tài khoản). Tài khoản bị xoá ngay: phiên, thiết bị, liên kết, lịch sử đăng nhập ứng dụng và hồ sơ bị xoá; nhật ký bảo mật chỉ giữ loại sự kiện, thời điểm và mã tài khoản.",
	"privacy.rights.deleteHelp": "Nếu không xoá được, liên hệ {email}.",
	"privacy.storage.title": "Lưu trữ",
	"privacy.storage.body":
		"Dữ liệu nằm trên máy chủ tại Việt Nam do chủ sở hữu dịch vụ quản lý, có sao lưu hằng ngày giữ 14 ngày.",
	"privacy.youtube.title": "YouTube API Services",
	"privacy.youtube.body":
		"Chủ sở hữu dịch vụ đăng video về các ứng dụng của mình lên kênh YouTube của chính mình bằng một công cụ dùng YouTube API Services. Công cụ chỉ thao tác trên các kênh đó: không đọc, không lưu và không chia sẻ dữ liệu YouTube của người dùng dịch vụ này. Việc dùng YouTube API Services tuân theo {youtubeTerms}, và Google xử lý dữ liệu theo {googlePrivacy}. Quyền đã cấp cho công cụ có thể thu hồi trong {googlePermissions}.",
	"privacy.youtube.terms": "Điều khoản dịch vụ của YouTube",
	"privacy.youtube.googlePrivacy": "Chính sách quyền riêng tư của Google",
	"privacy.youtube.permissions": "cài đặt bảo mật của tài khoản Google",
};
