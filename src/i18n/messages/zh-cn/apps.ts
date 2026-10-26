import type { enApps } from "../en/apps.js";
import type { Translation } from "../translation.js";

export const zhApps: Translation<typeof enApps> = {
	"apps.eyebrow": "{brand} 登录",
	"apps.title": "一个账号，通用所有 {brand} 应用",
	"apps.subtitle":
		"用 Google 或 GitHub 登录一次，即可在下方所有应用中使用同一个账号。",
	"apps.trust.providers": "使用 Google 或 GitHub 登录",
	"apps.trust.noPassword": "无需创建或记住密码",
	"apps.trust.control": "由你决定哪些应用可以访问",
	"apps.cta.account": "管理你的账号",
	"apps.cta.how": "登录如何进行",
	"apps.diagram.label":
		"通过 Google 或 GitHub 进入你的 {brand} 账号，即可登录 {apps}。",
	"apps.list.title": "可使用的应用",
	"apps.kind.web": "网页应用",
	"apps.kind.mcp": "MCP 服务器",
	"apps.kind.cli": "命令行",
	"apps.signInLabel": "登录方式",
	"apps.open": "打开",
	"apps.localmanWeb.description": "在浏览器中使用 Mock API 和 API 客户端。",
	"apps.localmanWeb.signIn": "在网站上选择登录。",
	"apps.localmanMcp.description":
		"让 Claude Code 等 AI 工具操作你的 Localman 项目。",
	"apps.localmanMcp.signIn":
		"在 AI 工具中把 {address} 添加为 MCP 服务器，然后在授权页面批准它可以执行的操作。",
	"apps.chatMcp.description":
		"让 Claude Code 等 AI 工具读取和发送消息，并管理你在 Chat 上的机器人。",
	"apps.chatMcp.signIn":
		"在 AI 工具中把 {address} 添加为 MCP 服务器，然后在授权页面批准它可以执行的操作。",
	"apps.tuneloCli.description": "从你的电脑向互联网打开隧道。",
	"apps.tuneloCli.signIn":
		"在终端运行 {command}，然后在 {device} 输入它显示的代码。",
	"apps.tuneloWeb.description": "在浏览器中查看你的隧道。",
	"apps.tuneloWeb.signIn": "在网站上选择登录。",
	"apps.chatWeb.description": "快速聊天，可搜索历史消息并使用机器人。",
	"apps.chatWeb.signIn": "在网站上选择登录。",
	"apps.scribeWeb.description": "录音并转写为可搜索、可编辑的文字稿。",
	"apps.scribeWeb.signIn": "在网站上选择登录。",
	"apps.miuWeb.description": "边玩边学数学和越南语的 3D 世界，可与朋友一起玩。",
	"apps.miuWeb.signIn": "在网站或 iPhone、Android 应用中选择登录。",
	"apps.tieudeWeb.description":
		"免费帮你写些小东西的 AI 机器人，靠自愿打赏维持运行。",
	"apps.tieudeWeb.signIn": "在网站上选择登录，即可获得更多免费次数。",
	"apps.steps.title": "登录流程",
	"apps.steps.choose.title": "选择一个应用",
	"apps.steps.choose.body": "在它的网站上选择登录，或在终端运行 {command}。",
	"apps.steps.provider.title": "使用 Google 或 GitHub 继续",
	"apps.steps.provider.body":
		"你关联的账号会为你登录。第一次登录时需选择用户名。",
	"apps.steps.back.title": "回到应用",
	"apps.steps.back.body":
		"来自 {brand} 以外的应用（例如 AI 工具）会先请求你的同意。",
	"apps.manage": "如需查看或移除可以访问你账号的应用，请打开{account}页面。",
};
