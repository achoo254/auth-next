import type { enTelegramBot } from "../en/telegram-bot.js";
import type { Translation } from "../translation.js";

export const zhTelegramBot: Translation<typeof enTelegramBot> = {
	"bot.start.howTo":
		"要关联此聊天，请打开你的 hoandat 账号页面并点击“{button}”。链接 10 分钟后过期，且只能使用一次。",
	"bot.link.ask":
		"将此 Telegram 聊天关联到 hoandat 账号 @{username}？只有在你本人刚从账号页面打开该链接时才确认。",
	"bot.link.confirm": "确认关联",
	"bot.link.expired":
		"该链接已过期或已被使用。请在 hoandat 账号页面创建新链接。",
	"bot.link.expiredShort": "链接已过期",
	"bot.link.otherAccount":
		"此 Telegram 聊天已关联到另一个 hoandat 账号。请先在该账号中取消关联。",
	"bot.link.otherAccountShort": "聊天已关联其他账号",
	"bot.link.done":
		"已将 Telegram 关联到 hoandat 账号 @{username}。你将在这里收到账号的安全通知。",
	"bot.link.doneShort": "已关联",
	"bot.link.moved":
		"hoandat 账号 @{username} 已将关联转移到另一个 Telegram 聊天。此聊天将不再收到通知。",
	"bot.notice.providerLinked":
		"hoandat 账号 @{username} 刚刚关联了 {provider}。如果不是你本人操作，请在账号页面取消关联。",
	"bot.notice.emailReclaimed":
		"邮箱 {email} 已从 hoandat 账号 @{username} 中移除，因为该邮箱的所有者已通过 {provider} 验证了它。你仍可使用该账号已关联的 Google 或 GitHub 登录。",
};
