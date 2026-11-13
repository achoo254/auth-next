import type { enAccount } from "../en/account.js";
import type { Translation } from "../translation.js";

export const viAccount: Translation<typeof enAccount> = {
	"account.pageTitle": "Tài khoản",
	"account.title": "Tài khoản {brand}",
	"account.signOut": "Đăng xuất",
	"account.noEmail": "Chưa có email",
	"account.emailVerified": "đã xác minh qua {provider}",
	"account.emailUnverified": "email chưa xác minh",
	"account.emailReclaimed":
		"Email {email} đã được gỡ khỏi tài khoản này lúc {date}, vì người sở hữu email đã xác minh nó qua Google, GitHub hoặc Apple.",
	"account.callbackFailed": "Chưa đăng nhập được vào trang tài khoản.",
	"account.group.account": "Tài khoản",
	"account.group.access": "Đăng nhập & ứng dụng",
	"account.nav": "Các mục của tài khoản",
	"account.overview": "Tóm tắt tài khoản",
	"account.stat.signIn": "Cách đăng nhập",
	"account.stat.places": "Nơi đang đăng nhập",
	"account.stat.apps": "App bên ngoài",
	"account.profile.title": "Hồ sơ",
	"account.profile.description":
		"Tên các ứng dụng của {brandDomain} hiển thị cho bạn.",
	"account.profile.empty":
		"Chưa có tên hiển thị, nên ứng dụng hiện @{username}.",
	"account.profile.nameLabel": "Tên hiển thị",
	"account.profile.save": "Lưu",
	"account.signIn.title": "Cách đăng nhập",
	"account.signIn.description":
		"{brand} không dùng mật khẩu: bạn đăng nhập bằng Google, GitHub hoặc Apple. Liên kết từ hai cách trở lên để vẫn vào được tài khoản khi mất một cách.",
	"account.signIn.empty":
		"Đăng nhập bằng Google, GitHub và Apple đang tạm tắt.",
	"account.signIn.notLinked": "Chưa liên kết",
	"account.signIn.linked": "Đã liên kết ({identity})",
	"account.signIn.linkedOff":
		"Đã liên kết ({identity}) · đăng nhập bằng cách này đang tạm tắt",
	"account.signIn.linkedOnly":
		"Đã liên kết ({identity}) · đây là cách đăng nhập duy nhất, không huỷ được",
	"account.signIn.link": "Liên kết {provider}",
	"account.signIn.unlink": "Huỷ liên kết {provider}",
	"account.places.title": "Nơi đang đăng nhập",
	"account.places.more": "Xem thêm {count} nơi",
	"account.places.description":
		"Trình duyệt, máy Tunelo và app điện thoại đang dùng tài khoản {brand} của bạn. Máy đăng nhập lại sẽ thay dòng cũ.",
	"account.sessions.empty": "Không có phiên nào.",
	"account.sessions.thisBrowser": "Trình duyệt này",
	"account.sessions.signedInAt": "Đăng nhập {date}",
	"account.sessions.signOutThis": "Đăng xuất trình duyệt này",
	"account.sessions.signOut": "Đăng xuất",
	"account.sessions.signOutOthers": "Đăng xuất mọi trình duyệt khác",
	"account.sessions.unknownBrowser": "Trình duyệt không rõ",
	"account.sessions.browser": "Trình duyệt",
	"account.sessions.unknownSystem": "hệ điều hành không rõ",
	"account.sessions.browserOn": "{browser} trên {system}",
	"account.apps.title": "App bên ngoài",
	"account.apps.description":
		"App không thuộc {brand} mà bạn cho dùng tài khoản, ví dụ coding agent dùng MCP. App của {brand} không cần quản lý ở đây.",
	"account.apps.empty": "Chưa cho app bên ngoài nào dùng tài khoản.",
	"account.apps.redirects": "Chuyển về: {hosts}",
	"account.apps.remove": "Gỡ quyền của ứng dụng",
	"account.telegram.title": "Telegram",
	"account.telegram.description":
		"Thông báo bảo mật của tài khoản, gửi tới chat Telegram của bạn.",
	"account.telegram.off": "Máy chủ này chưa bật thông báo qua Telegram.",
	"account.telegram.empty":
		"Liên kết để nhận thông báo bảo mật của tài khoản. Telegram không dùng để đăng nhập.",
	"account.telegram.linked":
		"Đã liên kết với {chat} lúc {date}. Dùng để nhận thông báo bảo mật của tài khoản.",
	"account.telegram.link": "Liên kết Telegram",
	"account.telegram.unlink": "Huỷ liên kết Telegram",
	"account.delete.title": "Xoá tài khoản",
	"account.delete.description":
		"Xoá vĩnh viễn tài khoản {brand} này cùng phiên, thiết bị và liên kết của nó.",
	"account.delete.open": "Xoá tài khoản…",
	"account.telegram.statusLinked": "đã liên kết",
	"account.telegram.statusNone": "chưa liên kết",
	"account.telegram.statusOff": "đang tắt",
};
