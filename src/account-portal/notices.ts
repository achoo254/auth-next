import type { AlertTone } from "../ui/components.js";

interface Notice {
	readonly tone: AlertTone;
	readonly text: string;
}

/** Messages shown on /account after a redirect (`?notice=<key>`). */
const NOTICES: Readonly<Record<string, Notice>> = {
	reauthed: {
		tone: "info",
		text: "Đã xác nhận lại danh tính. Thực hiện lại thao tác vừa rồi trong 10 phút tới.",
	},
	expired: { tone: "error", text: "Biểu mẫu đã hết hạn. Thử lại." },
	profile: { tone: "success", text: "Đã lưu hồ sơ." },
	password: {
		tone: "success",
		text: "Đã đổi mật khẩu. Các trình duyệt khác đã bị đăng xuất.",
	},
	"password-wrong": { tone: "error", text: "Mật khẩu hiện tại không đúng." },
	"password-locked": {
		tone: "error",
		text: "Tạm khoá do nhập sai nhiều lần. Thử lại sau 15 phút.",
	},
	"password-invalid": {
		tone: "error",
		text: "Mật khẩu mới cần ít nhất 7 ký tự và hai lần nhập phải khớp nhau.",
	},
	codes: { tone: "success", text: "Đã tạo bộ mã khôi phục mới." },
	"linked-google": { tone: "success", text: "Đã liên kết Google." },
	"linked-github": { tone: "success", text: "Đã liên kết GitHub." },
	unlinked: { tone: "success", text: "Đã huỷ liên kết." },
	"last-method": {
		tone: "error",
		text: "Không huỷ được: đây là cách đăng nhập cuối cùng của tài khoản. Đặt mật khẩu hoặc liên kết cách khác trước.",
	},
	"telegram-unlinked": { tone: "success", text: "Đã huỷ liên kết Telegram." },
	"session-revoked": { tone: "success", text: "Đã thu hồi phiên." },
	"device-revoked": { tone: "success", text: "Đã thu hồi thiết bị." },
	"app-revoked": { tone: "success", text: "Đã thu hồi quyền của ứng dụng." },
	"not-found": { tone: "error", text: "Không tìm thấy mục cần thu hồi." },
};

/**
 * A Map, so a crafted `?notice=` such as "constructor" or "__proto__" can
 * never reach an inherited property.
 */
export const ACCOUNT_NOTICES: ReadonlyMap<string, Notice> = new Map(
	Object.entries(NOTICES),
);
