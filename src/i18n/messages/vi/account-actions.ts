import type { enAccountActions } from "../en/account-actions.js";
import type { Translation } from "../translation.js";

export const viAccountActions: Translation<typeof enAccountActions> = {
	"notice.reauthed":
		"Đã xác nhận lại danh tính. Thực hiện lại thao tác vừa rồi trong 10 phút tới.",
	"notice.expired": "Biểu mẫu đã hết hạn. Thử lại.",
	"notice.profile": "Đã lưu hồ sơ.",
	"notice.linkedGoogle": "Đã liên kết Google.",
	"notice.linkedGithub": "Đã liên kết GitHub.",
	"notice.unlinked": "Đã huỷ liên kết.",
	"notice.lastMethod":
		"Không huỷ được: đây là cách đăng nhập cuối cùng của tài khoản. Liên kết Google hoặc GitHub còn lại trước.",
	"notice.telegramUnlinked": "Đã huỷ liên kết Telegram.",
	"notice.sessionRevoked": "Đã đăng xuất phiên.",
	"notice.otherSessionsRevoked": "Đã đăng xuất mọi phiên khác.",
	"notice.deviceRevoked": "Đã đăng xuất thiết bị.",
	"notice.appRevoked": "Đã gỡ quyền của ứng dụng.",
	"notice.notFound": "Không tìm thấy mục cần gỡ.",
	"confirm.app.title": "Gỡ quyền của ứng dụng?",
	"confirm.app.lead": "{app} sẽ không dùng được tài khoản hoandat của bạn nữa.",
	"confirm.app.canNow": "Hiện ứng dụng được:",
	"confirm.app.effect":
		"Phiên đăng nhập và token của ứng dụng ngừng hoạt động, và nó phải xin lại quyền. Access token nó đang giữ hết hạn trong vòng 15 phút.",
	"confirm.sessions.title": "Đăng xuất mọi phiên khác?",
	"confirm.sessions.lead":
		"Mọi trình duyệt bên dưới sẽ bị đăng xuất khỏi tài khoản hoandat. Trình duyệt này vẫn giữ đăng nhập.",
	"confirm.sessions.effect":
		"Ứng dụng đăng nhập qua các trình duyệt đó, như Localman và Tunelo bản web, cũng bị đăng xuất. Thiết bị Tunelo vẫn giữ đăng nhập.",
	"telegram.title": "Liên kết Telegram",
	"telegram.subtitle":
		"Mở bot hoandat trên Telegram, bấm Start rồi bấm “{button}” trong 10 phút.",
	"telegram.open": "Mở Telegram",
	"telegram.orSend": "Hoặc gửi lệnh sau cho bot {bot}:",
	"telegram.commandLabel": "Lệnh liên kết",
	"telegram.once":
		"Link chỉ dùng được một lần. Sau khi bot báo đã liên kết, tải lại trang tài khoản.",
};
