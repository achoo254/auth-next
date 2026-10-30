import type { enTelegramBot } from "../en/telegram-bot.js";
import type { Translation } from "../translation.js";

export const viTelegramBot: Translation<typeof enTelegramBot> = {
	"bot.start.howTo":
		"Để liên kết, mở trang tài khoản {brand} và bấm “{button}”. Link cũ hết hạn sau 10 phút và chỉ dùng được một lần.",
	"bot.link.ask":
		"Liên kết chat Telegram này với tài khoản {brand} @{username}? Chỉ bấm xác nhận nếu chính bạn vừa mở link từ trang tài khoản.",
	"bot.link.confirm": "Xác nhận liên kết",
	"bot.link.expired":
		"Link liên kết đã hết hạn hoặc đã được dùng. Tạo link mới ở trang tài khoản {brand}.",
	"bot.link.expiredShort": "Link đã hết hạn",
	"bot.link.otherAccount":
		"Chat Telegram này đã liên kết với một tài khoản {brand} khác. Huỷ liên kết ở tài khoản đó trước.",
	"bot.link.otherAccountShort": "Chat đã liên kết tài khoản khác",
	"bot.link.done":
		"Đã liên kết Telegram với tài khoản {brand} @{username}. Bạn sẽ nhận thông báo bảo mật của tài khoản ở đây.",
	"bot.link.doneShort": "Đã liên kết",
	"bot.link.moved":
		"Tài khoản {brand} @{username} đã chuyển liên kết sang một chat Telegram khác. Chat này sẽ không nhận thông báo nữa.",
	"bot.notice.providerLinked":
		"Tài khoản {brand} @{username} vừa được liên kết với {provider}. Nếu không phải bạn, hãy huỷ liên kết ở trang tài khoản.",
	"bot.notice.emailReclaimed":
		"Email {email} đã được gỡ khỏi tài khoản {brand} @{username} vì người sở hữu email đã xác minh nó qua {provider}. Bạn vẫn đăng nhập được bằng Google, GitHub hoặc Apple đã liên kết với tài khoản đó.",
};
