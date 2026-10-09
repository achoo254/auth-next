import { CREDENTIALS_SCOPE } from "../oidc/resources.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";

/** Plain-Vietnamese meaning of each scope, as shown on consent pages. */
const SCOPE_TEXT: Readonly<Record<string, string>> = {
	openid: "Biết bạn là ai (mã định danh tài khoản hoandat)",
	profile: "Xem tên, username và ảnh đại diện",
	email: "Xem địa chỉ email",
	offline_access: "Giữ đăng nhập khi bạn không mở ứng dụng (tối đa 30 ngày)",
	telegram: "Gửi thông báo tới chat Telegram bạn đã liên kết",
	"mock:read":
		"Xem project mock trên Localman mà bạn có quyền truy cập, gồm resource, schema và dữ liệu",
	"mock:write":
		"Tạo, sửa, xoá project và resource mock trên Localman, sinh hoặc reset dữ liệu",
	"client:read":
		"Xem workspace, collection, request và environment trong API client của Localman mà bạn có quyền truy cập (biến secret luôn bị che)",
	"client:write":
		"Tạo, sửa, xoá, import collection và request, đặt biến environment trong API client của Localman",
	"client:send":
		"Gửi request thay bạn qua proxy của Localman, kể cả tới localhost qua Tunelo (tính vào hạn mức proxy)",
	[CREDENTIALS_SCOPE]:
		"Tạo token truy cập cá nhân, secret của service account và access key trên Localman",
	"tunnels:open": "Mở tunnel mới bằng tài khoản của bạn",
	"tunnels:read": "Xem danh sách tunnel của bạn",
};

/** Shown in red above the buttons whenever a client asks for `credentials:write`. */
export const CREDENTIALS_WARNING =
	"Cho phép tạo khoá truy cập và secret mới thay bạn. Chỉ cấp cho ứng dụng bạn tin tưởng.";

export function describeScopes(scopes: readonly string[]): string[] {
	return [...new Set(scopes)].map(
		(scope) => SCOPE_TEXT[scope] ?? `Quyền "${scope}"`,
	);
}

export interface ConsentView {
	readonly host: string;
	readonly csrf: string;
	readonly uid: string;
	readonly clientName: string;
	/** Registered through DCR: nobody vouched for its name. */
	readonly unverified: boolean;
	readonly redirectHosts: readonly string[];
	readonly scopes: readonly string[];
	readonly username: string;
}

export function renderConsent(view: ConsentView): string {
	const body = html`${pageTitle(
		"Cấp quyền cho ứng dụng",
		html`Đang đăng nhập là <b>@${view.username}</b>.`,
	)}
<div class="consent-client" data-id="consent-client">
<p><b data-id="consent-client-name">${view.clientName}</b>${
		view.unverified
			? html` <span class="badge badge-warning" data-id="consent-unverified">Ứng dụng bên thứ ba chưa xác minh</span>`
			: ""
	}</p>
${
	view.redirectHosts.length > 0
		? html`<p class="help">Sau khi cho phép, bạn được chuyển tới: ${view.redirectHosts.map(
				(host, index) =>
					html`${index > 0 ? ", " : ""}<code data-id="consent-redirect-host">${host}</code>`,
			)}</p>`
		: ""
}
${
	view.unverified
		? html`<p class="help">Ứng dụng này tự đăng ký (ví dụ một coding agent dùng MCP). hoandat không kiểm tra ai đứng sau nó; chỉ cho phép nếu chính bạn vừa kết nối nó.</p>`
		: ""
}
</div>
<p class="label">Ứng dụng sẽ được:</p>
<ul class="scope-list" data-id="consent-scopes">${describeScopes(view.scopes).map((text) => html`<li>${text}</li>`)}</ul>
${
	view.scopes.includes(CREDENTIALS_SCOPE)
		? alertBox(
				"error",
				html`<span data-id="consent-credentials-warning">${CREDENTIALS_WARNING}</span>`,
			)
		: ""
}
<div class="auth-form">
<form method="post" action="/interaction/${view.uid}/consent">${csrfField(view.csrf)}${submitButton("Cho phép", { block: true, dataId: "consent-allow" })}</form>
<form method="post" action="/interaction/${view.uid}/abort">${csrfField(view.csrf)}${submitButton("Từ chối", { block: true, variant: "secondary", dataId: "consent-deny" })}</form>
</div>
<p class="help">Bạn có thể thu hồi quyền này bất cứ lúc nào ở trang tài khoản.</p>`;
	return renderPage({ title: "Cấp quyền", body, host: view.host });
}
