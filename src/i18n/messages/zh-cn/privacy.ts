import type { enPrivacy } from "../en/privacy.js";
import type { Translation } from "../translation.js";

export const zhPrivacy: Translation<typeof enPrivacy> = {
	"privacy.title": "隐私政策",
	"privacy.subtitle":
		"适用于登录服务 auth.{brandDomain}。更新于 2026年10月24日。",
	"privacy.stored.title": "我们存储的数据",
	"privacy.stored.profile": "用户名、邮箱地址、显示名称和头像。",
	"privacy.stored.noPassword":
		"本服务不使用密码。取消密码之前创建的账号可能仍保留旧密码的 argon2id 哈希和旧恢复码；它们已不再用于登录。",
	"privacy.stored.providers":
		"当你使用 Google、GitHub 或 Apple 登录时：你在该提供商处的账号 ID，以及提供商返回的已验证邮箱、姓名和头像。使用 Apple 时，邮箱可能是你选择共享的私密中转地址；我们保留一个令牌，仅用于在你移除关联时向 Apple 撤销授权。",
	"privacy.stored.telegram":
		"当你关联 Telegram 时：聊天 ID 和 Telegram 用户名。",
	"privacy.stored.sessions": "登录会话、设备和你已授权的应用，以及使用时间。",
	"privacy.stored.appUsage":
		"你登录各应用的记录（应用 ID、时间，以及是重新登录还是使用已有会话），不含 IP 地址和浏览器信息；保留 400 天。",
	"privacy.stored.securityLog":
		"安全日志（登录、关联或移除登录方式、撤销会话和权限），包含 IP 地址和浏览器；尚未发送的事件的 IP 地址和浏览器信息会在 30 天后删除。",
	"privacy.purpose.title": "使用目的",
	"privacy.purpose.body":
		"数据仅用于验证你的身份、保持登录、恢复账号、发现异常访问，以及汇总统计各应用的用户人数。本服务不发送邮件、不展示广告，不出售也不共享你的数据或这些统计。",
	"privacy.sharing.title": "共享",
	"privacy.sharing.body":
		"个人资料只提供给同一所有者运营的应用（Localman、Tunelo）或你已授权的应用，且仅限你同意的范围。不与任何其他第三方共享。",
	"privacy.rights.title": "你的权利",
	"privacy.rights.body":
		"在{account}页面，你可以查看和编辑个人资料，取消关联 Google、GitHub、Apple 或 Telegram，退出会话并撤销已授权的应用。",
	"privacy.rights.deleteHere":
		"你可以在{account}页面（删除账号）自行删除账号。账号会立即删除：会话、设备、关联、应用登录记录和个人资料都会被移除，安全日志只保留事件类型、时间和账号 ID。",
	"privacy.rights.deleteHelp": "如果无法删除，请联系 {email}。",
	"privacy.storage.title": "存储",
	"privacy.storage.body":
		"数据存放在越南的服务器上，由服务所有者管理，每日备份并保留 14 天。",
	"privacy.youtube.title": "YouTube API 服务",
	"privacy.youtube.body":
		"本服务的所有者使用一个调用 YouTube API 服务的工具，将介绍其应用的视频发布到自己的 YouTube 频道。该工具只操作这些频道：不会读取、存储或分享本服务用户的 YouTube 数据。使用 YouTube API 服务须遵守{youtubeTerms}，Google 按照{googlePrivacy}处理数据。授予该工具的权限可在{googlePermissions}中撤销。",
	"privacy.youtube.terms": "YouTube 服务条款",
	"privacy.youtube.googlePrivacy": "Google 隐私权政策",
	"privacy.youtube.permissions": "Google 账号的安全设置",
};
