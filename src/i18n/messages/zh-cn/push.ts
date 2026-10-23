import type { enPush } from "../en/push.js";
import type { Translation } from "../translation.js";

export const zhPush: Translation<typeof enPush> = {
	"push.newSignIn.title": "新的登录",
	"push.newSignIn.body":
		"你的 {brand} 账号刚刚被登录。如果不是你本人，请打开应用并退出该登录。",
	"push.providerLinked.title": "已添加登录方式",
	"push.providerLinked.body":
		"现在可以用 {provider} 登录你的 {brand} 账号。如果不是你本人，请在应用中解除关联。",
	"push.providerUnlinked.title": "已移除登录方式",
	"push.providerUnlinked.body": "{provider} 已不能再登录你的 {brand} 账号。",
	"push.emailReclaimed.title": "邮箱已移除",
	"push.emailReclaimed.body":
		"你未验证的邮箱已从 {brand} 账号中移除，因为其所有者已通过 {provider} 验证了它。",
	"push.accessRevoked.title": "访问权限已撤销",
	"push.accessRevoked.body": "{app} 已不能再访问你的 {brand} 账号。",
	"push.accessRevoked.bodyOther":
		"某个会话、设备或应用已失去对你的 {brand} 账号的访问权限。",
};
