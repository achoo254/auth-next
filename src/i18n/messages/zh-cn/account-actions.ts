import type { enAccountActions } from "../en/account-actions.js";
import type { Translation } from "../translation.js";

export const zhAccountActions: Translation<typeof enAccountActions> = {
	"notice.reauthed": "已重新确认身份。请在 10 分钟内重新执行刚才的操作。",
	"notice.expired": "表单已过期，请重试。",
	"notice.profile": "已保存个人资料。",
	"notice.linkedGoogle": "已关联 Google。",
	"notice.linkedGithub": "已关联 GitHub。",
	"notice.unlinked": "已取消关联。",
	"notice.lastMethod":
		"无法取消关联：这是账号最后一种登录方式。请先关联 Google 或 GitHub 中的另一个。",
	"notice.telegramUnlinked": "已取消关联 Telegram。",
	"notice.sessionRevoked": "已退出该会话。",
	"notice.otherSessionsRevoked": "已退出其他所有会话。",
	"notice.deviceRevoked": "已退出该设备。",
	"notice.appRevoked": "已移除该应用的访问权限。",
	"notice.notFound": "找不到要移除的项目。",
	"confirm.app.title": "移除应用访问权限？",
	"confirm.app.lead": "{app} 将无法再使用你的 hoandat 账号。",
	"confirm.app.canNow": "它目前可以：",
	"confirm.app.effect":
		"它的登录和 token 将失效，需再次征得你同意才能访问。它已持有的 access token 将在 15 分钟内过期。",
	"confirm.sessions.title": "退出其他所有会话？",
	"confirm.sessions.lead":
		"下面的每个浏览器都会退出你的 hoandat 账号。此浏览器保持登录。",
	"confirm.sessions.effect":
		"通过这些浏览器登录的应用（例如网页版 Localman 和 Tunelo）也会退出。Tunelo 设备保持登录。",
	"telegram.title": "关联 Telegram",
	"telegram.subtitle":
		"在 Telegram 中打开 hoandat bot，点击 Start，然后在 10 分钟内点击“Xác nhận liên kết”（确认关联）。",
	"telegram.open": "打开 Telegram",
	"telegram.orSend": "或者向 bot {bot} 发送以下命令：",
	"telegram.commandLabel": "关联命令",
	"telegram.once": "该链接只能使用一次。bot 提示已关联后，请刷新账号页面。",
};
