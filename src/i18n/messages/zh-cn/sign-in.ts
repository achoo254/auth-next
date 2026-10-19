import type { enSignIn } from "../en/sign-in.js";
import type { Translation } from "../translation.js";

export const zhSignIn: Translation<typeof enSignIn> = {
	"login.title": "登录",
	"login.titleForApp": "登录以继续使用 {app}",
	"login.tagline": "一个 {brand} 账号，通用于 Localman 和 Tunelo。",
	"login.forDevice": "登录以批准设备。",
	"login.continueTo": "以继续使用 {app}。",
	"login.with": "使用 {provider} 登录",
	"login.noProvider":
		"Google 和 GitHub 登录暂时关闭，因此目前无法登录或注册。请稍后重试。",
	"login.firstTime": "首次使用以上任一方式登录将创建新的 {brand} 账号。",
	"login.cancel": "取消登录",
	"signup.title": "创建 {brand} 账号",
	"signup.pageTitle": "注册",
	"signup.subtitle":
		"一个账号通用于 Localman 和 Tunelo。使用以下任一账号注册：{brand} 不使用密码，也不发送邮件。",
	"signup.with": "使用 {provider} 注册",
	"signup.haveAccount": "已有账号？{link}",
	"username.title": "选择用户名",
	"username.subtitle":
		"使用 {provider} 为 {email}（已验证）创建 {brand} 账号。",
	"username.reclaimWarning":
		"此邮箱属于另一个尚未验证邮箱的 {brand} 账号。如果那是你的账号，并且已关联另一个 Google 或 GitHub 账号，请{link}，然后在账号页面关联 {provider}。如果继续，该邮箱将转移到新账号；原账号保留其他登录方式。",
	"username.reclaimLink": "用那种方式登录",
	"username.label": "用户名",
	"username.help":
		"3–30 个字符：小写字母、数字和下划线。其他人通过此用户名邀请你。",
	"username.submit": "创建账号",
	"username.back": "返回登录",
	"username.taken": "该用户名已被使用，请换一个。",
	"username.invalid":
		"用户名需为 3–30 个字符，只能包含小写字母、数字或下划线。",
	"username.emailTaken": "该邮箱刚被另一个账号使用。请改用那个账号登录。",
	"upstream.expired": "{provider} 登录已过期，请重新开始。",
	"upstream.failed": "无法使用 {provider} 登录。请几分钟后重试。",
	"upstream.link.ownedByOther":
		"此 {provider} 账号已关联到另一个 {brand} 账号。",
	"upstream.link.alreadyLinked":
		"你的账号已关联另一个 {provider} 账号。请先取消那个关联。",
	"upstream.rejected.noVerifiedEmail":
		"此账号没有已验证的邮箱，无法用于登录 {brand}。",
	"upstream.rejected.disabled": "此 {brand} 账号已被锁定。",
	"upstream.rejected.otherProviderAccount":
		"该邮箱所属的 {brand} 账号已关联同一提供商的另一个账号。请使用已关联的账号登录。",
	"upstream.rejected.other": "无法登录。",
	"logout.title": "退出登录",
	"logout.byApp": "{app} 想让你退出 {brand} 账号。",
	"logout.question": "要在此浏览器上退出 {brand} 账号吗？",
	"logout.confirm": "退出登录",
	"logout.keep": "不，保持登录",
	"logout.help":
		"在这里退出登录，也会在此浏览器上退出网页版 Localman 和 Tunelo。",
	"logout.doneTitle": "已退出登录",
	"logout.done": "你已在此浏览器上退出 {brand} 账号。",
	"logout.signInAgain": "重新登录",
};
