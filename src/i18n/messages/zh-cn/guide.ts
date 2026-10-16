import type { enGuide } from "../en/guide.js";
import type { Translation } from "../translation.js";

export const zhGuide: Translation<typeof enGuide> = {
	"guide.title": "使用你自己的域名",
	"guide.subtitle":
		"在你拥有的域名上运行登录、Chat、Localman 和 Tunelo，并使用独立的账号。",
	"guide.intro":
		"设置完成后，你的用户在 auth.<domain> 登录，在 chat.<domain> 使用 Chat，在 localman.<domain> 使用 Localman，在 tunnel.<domain> 使用 Tunelo。无需安装任何东西：一切都运行在 {brandDomain} 的服务器上。你的域名的账号、会话、项目和隧道不会与其他域名混在一起。",
	"guide.figure": "图 {number}。",
	"guide.prepare.title": "准备工作",
	"guide.prepare.account":
		"一个已关联 Google 或 GitHub 的 auth.{brandDomain} 账号。该 Google 或 GitHub 身份将成为域名的所有者。",
	"guide.prepare.dns":
		"修改该域名 DNS 的权限。你拥有的域名下的子域名（dev.example.com）也可以。",
	"guide.prepare.oauth":
		"一个 Google Cloud 或 GitHub 账号，用于为域名创建登录应用（第 5 步）。",
	"guide.prepare.cloudflare":
		"建议：DNS 托管在 Cloudflare，并准备一个 API 令牌（第 6 步）。没有令牌时，子域名上的 mock 和隧道无法获得证书。",
	"guide.claim.title": "1. 开始认领",
	"guide.claim.body":
		"打开 {claim}，输入你的域名并选择所有者身份。认领有效期为 24 小时。",
	"guide.claim.figure": "开始认领：域名及其所有者。",
	"guide.dns.title": "2. 添加 DNS 记录",
	"guide.dns.body":
		"页面列出一条 TXT 记录和六条 A 记录。点击名称或内容即可全选，然后复制到 DNS 服务商。",
	"guide.dns.figure": "需要添加的记录，带有你的值。",
	"guide.dns.dnsOnly":
		"仅 DNS（推荐）：A 记录直接指向服务器。所有功能都可用，包括 Chat 的实时连接和所有子域名。",
	"guide.dns.proxied":
		"经 Cloudflare 代理（橙色云朵）也可以，但区域的 SSL 模式须为 Full (strict)。服务器为这些主机持有真实证书。",
	"guide.dns.flexible":
		"避免使用 Flexible：此时 Cloudflare 会切断 Chat 的实时连接，消息无法同步。如果区域必须保持 Flexible，请添加一条 Configuration Rule，为 chat.<domain> 设置 SSL Full (strict)。",
	"guide.dns.wildcard":
		"*.localman. 和 *.tunnel. 是两级通配符：Cloudflare 免费套餐没有对应的边缘证书。除非你为此付费，否则请设为仅 DNS。",
	"guide.dns.keepTxt":
		"认领后请保留 TXT 记录：服务器每 6 小时检查一次，连续 3 次检查失败的域名会被暂停，直到 DNS 恢复正确。",
	"guide.verify.title": "3. 检查 DNS",
	"guide.verify.body":
		"等待几分钟让 DNS 生效，然后点击“检查 DNS”。尚未指向服务器的记录会被标记；修改后再检查。",
	"guide.verify.wrongFigure": "有一条记录尚未正确：chat.<domain> 被标记。",
	"guide.verify.done":
		"所有记录都正确后，域名即归你所有，证书会在几分钟内签发。域名出现在“你的域名”中。",
	"guide.verify.doneFigure": "已认领的域名，可以打开管理页。",
	"guide.admin.title": "4. 打开管理页",
	"guide.admin.body":
		"点击“打开管理页”。链接只能使用一次，2 分钟内有效，会在 auth.<domain>/admin 打开 30 分钟的管理会话；会话结束后，请从 {claim} 重新打开。",
	"guide.admin.deadline":
		"请在 48 小时内添加登录方式：逾期仍未添加的域名会被移除，可重新认领。",
	"guide.admin.figure": "管理页：顶部是状态、地址和证书。",
	"guide.signin.title": "5. 添加 Google 或 GitHub 登录",
	"guide.signin.body":
		"你的用户通过属于你域名的 Google 或 GitHub 应用登录。一个就够了，也可以两个都加。",
	"guide.signin.github":
		"GitHub：Settings、Developer settings、OAuth Apps、New OAuth App。Homepage URL 填 https://auth.<domain>，Redirect URI 填 https://auth.<domain>/oauth/github/callback。然后生成 client secret。",
	"guide.signin.googleBranding":
		"Google：在 Google Cloud 中打开 Google Auth Platform 的 Branding。填写主页 https://auth.<domain>、隐私政策 https://auth.<domain>/privacy（该页面已存在），并把你的域名加入 authorized domains。",
	"guide.signin.googleBrandingFigure":
		"Google Auth Platform 的 Branding：主页、隐私政策和 authorized domain。",
	"guide.signin.googleClient":
		"然后在 Clients 中点击 Create client：类型选 Web application，authorized redirect URI 填 https://auth.<domain>/oauth/google/callback。",
	"guide.signin.googleClientFigure":
		"Create OAuth client ID：Web application 及其 redirect URI。",
	"guide.signin.paste":
		"把 client ID 和 client secret 粘贴到管理页并保存。保存一个登录方式后域名即启用。secret 不会再显示，最后一个登录方式不能移除。",
	"guide.signin.pasteFigure": "管理页显示需要登记的确切回调 URL。",
	"guide.token.title": "6. Cloudflare 令牌（DNS 在 Cloudflare 上）",
	"guide.token.body":
		"mock（<secret>.localman.<domain>）和隧道（<name>.tunnel.<domain>）需要通过 DNS 验证的通配符证书。在 dash.cloudflare.com：My Profile、API Tokens、Create Token，选择 Edit zone DNS 模板和你域名的区域。粘贴到管理页；页面会先创建并删除一条 TXT 记录进行检查，然后为证书服务密封该令牌。",
	"guide.token.figure": "粘贴 Cloudflare 令牌的位置。",
	"guide.token.without":
		"没有令牌时主要页面仍可使用；子域名上的 mock 和隧道则不可用。",
	"guide.users.title": "7. 你的用户",
	"guide.users.accounts":
		"账号：https://auth.<domain>。与 {brandDomain} 的账号完全分开，即使是同一个人。",
	"guide.users.chat": "Chat：https://chat.<domain>。",
	"guide.users.localman":
		"Localman：https://localman.<domain>；mock 在 https://<secret>.localman.<domain>；MCP 在 https://localman.<domain>/mcp。",
	"guide.users.tunelo":
		"Tunelo：CLI 1.8.0 或更高版本（npm install -g tunelo@latest），然后运行 tunelo login --server https://tunnel.<domain>。",
	"guide.keep.title": "保留或移除域名",
	"guide.keep.body":
		"只要 TXT 记录还在、各记录仍指向服务器，域名就归你所有。要移除：删除 TXT 记录或联系运营者；其证书、令牌和所有数据都会被删除，域名可重新认领。",
	"guide.dns.cloudflareRecordFigure":
		"Cloudflare 的 DNS、Add record：A 记录保持仅 DNS（灰色云朵）。",
	"guide.dns.sslModeFigure":
		"Cloudflare 的 SSL/TLS：经代理的主机请选择 Full (Strict) 并保存，不要选 Flexible。",
	"guide.signin.githubFigure":
		"GitHub 的 Register a new OAuth app：主页和 redirect URI。",
	"guide.token.templateFigure":
		"Cloudflare 的 API Tokens、Create Token：使用 Edit zone DNS 模板。",
	"guide.token.createFigure":
		"Zone DNS Edit 权限，在 Zone Resources 中限定为你的域名。",
	"claim.guideLink": "带截图的分步指南",
};
