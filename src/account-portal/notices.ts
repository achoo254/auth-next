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
	"linked-google": { tone: "success", text: "Đã liên kết Google." },
	"linked-github": { tone: "success", text: "Đã liên kết GitHub." },
	unlinked: { tone: "success", text: "Đã huỷ liên kết." },
	"last-method": {
		tone: "error",
		text: "Không huỷ được: đây là cách đăng nhập cuối cùng của tài khoản. Liên kết Google hoặc GitHub còn lại trước.",
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
