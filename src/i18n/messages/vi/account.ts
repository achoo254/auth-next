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
		"Email {email} đã được gỡ khỏi tài khoản này lúc {date}, vì người sở hữu email đã xác minh nó qua Google/GitHub.",
	"account.callbackFailed": "Chưa đăng nhập được vào trang tài khoản.",
	"account.group.account": "Tài khoản",
	"account.group.security": "Bảo mật",
	"account.group.connections": "Kết nối",
	"account.nav": "Các mục của tài khoản",
	"account.overview": "Tóm tắt tài khoản",
	"account.stat.signIn": "Cách đăng nhập",
	"account.stat.sessions": "Phiên đang mở",
	"account.stat.devices": "Thiết bị",
	"account.stat.apps": "Ứng dụng được cấp quyền",
	"account.profile.title": "Hồ sơ",
	"account.profile.description": "Tên Localman và Tunelo hiển thị cho bạn.",
	"account.profile.empty":
		"Chưa có tên hiển thị, nên ứng dụng hiện @{username}.",
	"account.profile.nameLabel": "Tên hiển thị",
	"account.profile.save": "Lưu",
	"account.signIn.title": "Cách đăng nhập",
	"account.signIn.description":
		"{brand} không dùng mật khẩu: bạn đăng nhập bằng Google hoặc GitHub. Liên kết cả hai để vẫn vào được tài khoản khi mất một cách.",
	"account.signIn.empty": "Đăng nhập bằng Google và GitHub đang tạm tắt.",
	"account.signIn.notLinked": "Chưa liên kết",
	"account.signIn.linked": "Đã liên kết ({identity})",
	"account.signIn.linkedOff":
		"Đã liên kết ({identity}) · đăng nhập bằng cách này đang tạm tắt",
	"account.signIn.linkedOnly":
		"Đã liên kết ({identity}) · đây là cách đăng nhập duy nhất, không huỷ được",
	"account.signIn.link": "Liên kết {provider}",
	"account.signIn.unlink": "Huỷ liên kết {provider}",
	"account.sessions.title": "Phiên đang mở",
	"account.sessions.description":
		"Các trình duyệt đang đăng nhập tài khoản {brand} của bạn.",
	"account.sessions.empty": "Không có phiên nào.",
	"account.sessions.thisBrowser": "Trình duyệt này",
	"account.sessions.signedInAt": "Đăng nhập {date}",
	"account.sessions.signOutThis": "Đăng xuất trình duyệt này",
	"account.sessions.signOut": "Đăng xuất phiên",
	"account.sessions.signOutOthers": "Đăng xuất mọi phiên khác",
	"account.sessions.unknownBrowser": "Trình duyệt không rõ",
	"account.sessions.browser": "Trình duyệt",
	"account.sessions.unknownSystem": "hệ điều hành không rõ",
	"account.sessions.browserOn": "{browser} trên {system}",
	"account.devices.title": "Thiết bị",
	"account.devices.description":
		"Các máy đăng nhập bằng Tunelo CLI hoặc ứng dụng trên điện thoại. Mỗi máy đăng xuất riêng.",
	"account.devices.empty": "Chưa có máy nào đăng nhập bằng {command}.",
	"account.devices.dates": "Cho phép lúc {granted} · hết hạn {expires}",
	"account.devices.signOut": "Đăng xuất thiết bị",
	"account.apps.title": "Ứng dụng đã cấp quyền",
	"account.apps.description":
		"Ứng dụng bạn cho phép dùng tài khoản, ví dụ coding agent dùng MCP.",
	"account.apps.empty": "Chưa cấp quyền cho ứng dụng nào.",
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
