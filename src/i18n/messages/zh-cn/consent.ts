import type { enConsent } from "../en/consent.js";
import type { Translation } from "../translation.js";

export const zhConsent: Translation<typeof enConsent> = {
	"consent.pageTitle": "授予访问权限",
	"consent.titleForApp": "允许 {app} 使用你的 {brand} 账号",
	"consent.titleExternal": "允许外部应用使用你的 {brand} 账号",
	"consent.redirect":
		"允许后，你将返回 {host}，并附带一个代码，应用用它换取 token。",
	"consent.willBeAbleTo": "该应用将能够：",
	"consent.allow": "允许",
	"consent.deny": "拒绝",
	"consent.revokeHint": "你可以随时在账号页面撤销此权限。",
	"consent.externalNotice":
		"外部应用，并非由 {brandDomain} 发布。应用名称由其自行填写，{brand} 不核实其背后是谁；仅当你刚刚亲自连接它时才允许（例如使用 MCP 的 coding agent）。",
	"consent.lookalikeWarning":
		"该应用名称看起来像 {brandDomain} 的产品，但并不是，而且它会把你带回一个网站，而不是你自己的电脑。仅当你认出上面的地址属于你刚刚亲自连接的应用时才允许；否则请拒绝。",
	"consent.credentialsWarning":
		"允许该应用代你创建新的访问密钥和 secret。只授权给你信任的应用。",
	"consent.botsAdminWarning":
		"允许该应用把发给你的机器人的所有消息转发到其他地址（webhook）、重新签发机器人 token 并删除机器人。只授权给你信任的应用。",
	"scope.openid": "知道你是谁（你的 {brand} 账号 ID）",
	"scope.profile": "查看你的姓名、用户名和头像",
	"scope.email": "查看你的邮箱地址",
	"scope.offlineAccess": "在你未打开应用时保持登录（最长 30 天）",
	"scope.telegram": "向你关联的 Telegram 聊天发送通知",
	"scope.mockRead":
		"查看你可访问的 Localman mock project，包括 resource、schema 和数据",
	"scope.mockWrite":
		"在 Localman 上创建、编辑、删除 mock project 和 resource，生成或重置数据",
	"scope.clientRead":
		"查看你可访问的 Localman API client 中的 workspace 及其成员、collection、request 和 environment，以及它们的共享设置（secret 变量始终隐藏）",
	"scope.clientWrite":
		"在 Localman API client 中创建、编辑、删除、导入 collection 和 request，设置 environment 变量并管理 workspace",
	"scope.clientSend":
		"通过 Localman proxy 代你发送 request，包括经 Tunelo 发往 localhost（计入 proxy 额度）",
	"scope.credentialsWrite":
		"在 Localman 上创建个人访问 token、service account secret 和访问密钥",
	"scope.tunnelsOpen": "使用你的账号打开新的 tunnel",
	"scope.tunnelsRead": "查看你的 tunnel 列表",
	"scope.chatRead":
		"查看你在 Chat 上的会话列表，阅读和搜索其中的消息，以及用户和成员信息",
	"scope.chatWrite":
		"以你的身份在 Chat 上发送、编辑、删除消息，标记已读并添加表情回应",
	"scope.botsRead":
		"查看你在 Chat 上的机器人、其 webhook 配置和消息投递状态（包括投递失败的消息）",
	"scope.botsWrite":
		"在 Chat 上创建机器人，编辑机器人的信息和命令，重新投递或丢弃投递失败的消息",
	"scope.botsAdmin":
		"在 Chat 上设置或移除 webhook、重新签发 token 并删除你的机器人",
	"scope.unknown": "权限“{scope}”",
	"device.input.title": "设备登录",
	"device.input.subtitle":
		"输入你机器上显示的代码（例如 tunelo 的终端窗口中）。",
	"device.input.label": "设备代码",
	"device.error.noCode": "请输入你机器上显示的代码。",
	"device.error.notFound": "代码不正确。请核对你机器上的代码。",
	"device.error.expired":
		"代码已过期。请在机器上重新运行登录命令以获取新代码。",
	"device.error.used": "此代码已被使用。请在机器上重新运行登录命令。",
	"device.error.aborted": "已拒绝。另一台机器不会获得访问权限。",
	"device.error.other": "无法处理该请求。请几分钟后重试。",
	"device.confirm.title": "核对设备代码",
	"device.confirm.subtitle": "来自 {device} 的请求。",
	"device.confirm.help": "仅当上面的代码与你机器上显示的代码一致时才继续。",
	"device.confirm.match": "代码一致，继续",
	"device.onMachine": "机器 {machine} 上的 {app}",
	"device.unknownName": "未知机器",
	"device.genericLabel": "设备",
	"device.success.pageTitle": "已允许设备",
	"device.success.title": "已允许",
	"device.success.subtitle": "{device} 已登录你的账号。",
	"device.success.alert": "回到终端，机器会自动继续。你可以关闭此页面。",
	"device.success.manage": "在账号页面管理设备",
	"device.approve.title": "批准设备",
	"device.approve.question": "允许 {device}？",
	"device.approve.code": "代码：{code}",
	"device.approve.ip": "请求来自 IP {ip}",
};
