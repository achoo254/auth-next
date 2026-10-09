import { CREDENTIALS_SCOPE } from "../oidc/resources.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { externalAppBadge, quotedClientName } from "./client-label.js";

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

/** Shown on consent for every app registered through DCR. */
export const EXTERNAL_APP_NOTICE =
	"Ứng dụng bên ngoài, không do hoandat.com phát hành. Tên ứng dụng do chính nó tự khai và hoandat không kiểm tra ai đứng sau nó; chỉ cho phép nếu chính bạn vừa kết nối nó (ví dụ một coding agent dùng MCP).";

/** Shown in red when a DCR app's name reads like Localman, Tunelo or hoandat. */
export const LOOKALIKE_NAME_WARNING =
	"Tên ứng dụng giống sản phẩm của hoandat.com nhưng không phải. Điều này chỉ bình thường khi chính bạn vừa thêm Localman MCP vào một coding agent trên máy mình (khi đó tên có chữ localman và bạn được chuyển về localhost hoặc 127.0.0.1); nếu không, hãy từ chối.";

export interface ConsentView {
	readonly host: string;
	readonly csrf: string;
	readonly uid: string;
	readonly clientName: string;
	/** Registered through DCR: its name is self-declared, nobody vouched for it. */
	readonly external: boolean;
	/** An external app whose name reads like a first-party one. */
	readonly imitatesFirstParty: boolean;
	/** Host of the redirect_uri of this request: where the code is sent. */
	readonly redirectHost: string | undefined;
	readonly scopes: readonly string[];
	readonly username: string;
}

function clientBlock(view: ConsentView): SafeHtml {
	const name = view.external
		? html`${quotedClientName(view.clientName, "consent-client-name")} ${externalAppBadge("consent-external")}`
		: html`<b data-id="consent-client-name">${view.clientName}</b>`;
	return html`<div class="consent-client" data-id="consent-client">
<p>${name}</p>
${
	view.redirectHost
		? html`<p class="help">Sau khi cho phép, bạn được chuyển về <code data-id="consent-redirect-host">${view.redirectHost}</code> kèm mã để ứng dụng nhận token.</p>`
		: ""
}
</div>
${
	view.external
		? alertBox(
				"warning",
				html`<span data-id="consent-external-notice">${EXTERNAL_APP_NOTICE}</span>`,
			)
		: ""
}
${
	view.imitatesFirstParty
		? alertBox(
				"error",
				html`<span data-id="consent-lookalike-warning">${LOOKALIKE_NAME_WARNING}</span>`,
			)
		: ""
}`;
}

export function renderConsent(view: ConsentView): string {
	const body = html`${pageTitle(
		"Cấp quyền cho ứng dụng",
		html`Đang đăng nhập là <b>@${view.username}</b>.`,
	)}
${clientBlock(view)}
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
