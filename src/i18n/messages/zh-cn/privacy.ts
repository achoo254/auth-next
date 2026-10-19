import type { enPrivacy } from "../en/privacy.js";
import type { Translation } from "../translation.js";

export const zhPrivacy: Translation<typeof enPrivacy> = {
	"privacy.title": "隐私政策",
	"privacy.subtitle":
		"适用于登录服务 auth.{brandDomain}。更新于 2026年10月19日。",
	"privacy.stored.title": "我们存储的数据",
	"privacy.stored.profile": "用户名、邮箱地址、显示名称和头像。",
	"privacy.stored.noPassword":
		"本服务不使用密码。取消密码之前创建的账号可能仍保留旧密码的 argon2id 哈希和旧恢复码；它们已不再用于登录。",
	"privacy.stored.providers":
		"当你使用 Google、GitHub 或 Apple 登录时：你在该提供商处的账号 ID，以及提供商返回的已验证邮箱、姓名和头像。使用 Apple 时，邮箱可能是你选择共享的私密中转地址；我们保留一个令牌，仅用于在你移除关联时向 Apple 撤销授权。",
	"privacy.stored.telegram":
		"当你关联 Telegram 时：聊天 ID 和 Telegram 用户名。",
	"privacy.stored.sessions": "登录会话、设备和你已授权的应用，以及使用时间。",
	"privacy.stored.securityLog":
		"安全日志（登录、关联或移除登录方式、撤销会话和权限），包含 IP 地址和浏览器；尚未发送的事件的 IP 地址和浏览器信息会在 30 天后删除。",
	"privacy.purpose.title": "使用目的",
	"privacy.purpose.body":
		"数据仅用于验证你的身份、保持登录、恢复账号和发现异常访问。本服务不发送邮件、不展示广告，也不出售数据。",
	"privacy.sharing.title": "共享",
	"privacy.sharing.body":
		"个人资料只提供给同一所有者运营的应用（Localman、Tunelo）或你已授权的应用，且仅限你同意的范围。不与任何其他第三方共享。",
	"privacy.rights.title": "你的权利",
	"privacy.rights.body":
		"在{account}页面，你可以查看和编辑个人资料，取消关联 Google、GitHub、Apple 或 Telegram，退出会话并撤销已授权的应用。如需删除账号，请联系 {email}。",
	"privacy.storage.title": "存储",
	"privacy.storage.body":
		"数据存放在越南的服务器上，由服务所有者管理，每日备份并保留 14 天。",
};
