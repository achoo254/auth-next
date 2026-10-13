import type { enPrivacy } from "../en/privacy.js";
import type { Translation } from "../translation.js";

export const viPrivacy: Translation<typeof enPrivacy> = {
	"privacy.title": "Chính sách quyền riêng tư",
	"privacy.subtitle":
		"Áp dụng cho dịch vụ đăng nhập auth.{brandDomain}. Cập nhật ngày 09/10/2026.",
	"privacy.stored.title": "Dữ liệu được lưu",
	"privacy.stored.profile":
		"Tên đăng nhập, địa chỉ email, tên hiển thị và ảnh đại diện.",
	"privacy.stored.noPassword":
		"Dịch vụ không dùng mật khẩu. Tài khoản tạo trước khi bỏ mật khẩu có thể vẫn còn bản băm argon2id của mật khẩu và mã khôi phục cũ; chúng không còn được dùng để đăng nhập.",
	"privacy.stored.providers":
		"Khi bạn đăng nhập bằng Google hoặc GitHub: mã định danh tài khoản ở nhà cung cấp, email đã xác minh, tên và ảnh đại diện mà nhà cung cấp trả về.",
	"privacy.stored.telegram":
		"Khi bạn liên kết Telegram: mã chat và tên người dùng Telegram.",
	"privacy.stored.sessions":
		"Phiên đăng nhập, thiết bị và ứng dụng bạn đã cấp quyền, kèm thời điểm sử dụng.",
	"privacy.stored.securityLog":
		"Nhật ký bảo mật (đăng nhập, liên kết hoặc gỡ phương thức đăng nhập, thu hồi phiên và quyền) gồm địa chỉ IP và trình duyệt; IP và trình duyệt của sự kiện chưa gửi đi bị xoá sau 30 ngày.",
	"privacy.purpose.title": "Mục đích sử dụng",
	"privacy.purpose.body":
		"Dữ liệu chỉ dùng để xác thực bạn, giữ phiên đăng nhập, khôi phục tài khoản và phát hiện truy cập bất thường. Dịch vụ không gửi email, không hiển thị quảng cáo và không bán dữ liệu.",
	"privacy.sharing.title": "Chia sẻ",
	"privacy.sharing.body":
		"Thông tin hồ sơ chỉ được cấp cho các ứng dụng do cùng chủ sở hữu vận hành (Localman, Tunelo) hoặc ứng dụng bạn đã đồng ý cấp quyền, trong phạm vi bạn đồng ý. Không chia sẻ cho bên thứ ba nào khác.",
	"privacy.rights.title": "Quyền của bạn",
	"privacy.rights.body":
		"Tại trang {account}, bạn xem và sửa hồ sơ, gỡ liên kết Google, GitHub hoặc Telegram, thu hồi phiên và ứng dụng đã cấp quyền. Để xoá tài khoản, liên hệ {email}.",
	"privacy.storage.title": "Lưu trữ",
	"privacy.storage.body":
		"Dữ liệu nằm trên máy chủ tại Việt Nam do chủ sở hữu dịch vụ quản lý, có sao lưu hằng ngày giữ 14 ngày.",
};
