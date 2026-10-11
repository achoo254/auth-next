import type { enApps } from "../en/apps.js";
import type { Translation } from "../translation.js";

export const zhApps: Translation<typeof enApps> = {
	"apps.title": "使用 hoandat 账号的应用",
	"apps.subtitle":
		"一个 hoandat 账号即可通过 Google 或 GitHub 登录以下所有应用。",
	"apps.open": "打开",
	"apps.localmanWeb.description": "在浏览器中使用 Mock API 和 API 客户端。",
	"apps.localmanWeb.signIn": "在网站上选择登录。",
	"apps.localmanMcp.description":
		"让 Claude Code 等 AI 工具操作你的 Localman 项目。",
	"apps.localmanMcp.signIn":
		"在 AI 工具中把 {address} 添加为 MCP 服务器，然后在授权页面批准它可以执行的操作。",
	"apps.tuneloCli.description": "从你的电脑向互联网打开隧道。",
	"apps.tuneloCli.signIn":
		"在终端运行 {command}，然后在 {device} 输入它显示的代码。",
	"apps.tuneloWeb.description": "在浏览器中查看你的隧道。",
	"apps.tuneloWeb.signIn": "在网站上选择登录。",
	"apps.manage": "如需查看或移除可以访问你账号的应用，请打开{account}页面。",
};
