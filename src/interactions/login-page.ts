import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import {
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { clientLabel } from "./client-label.js";

/** "Đăng nhập với Google" style buttons; hidden for unconfigured providers. */
export function upstreamButtons(
	uid: string,
	providers: readonly UpstreamProvider[],
	verb: string,
	purpose: "login" | "reset" = "login",
): SafeHtml {
	if (providers.length === 0) return html``;
	const query = purpose === "reset" ? "?purpose=reset" : "";
	return html`<div class="oauth">${providers.map(
		(provider) =>
			html`<a class="btn btn-secondary btn-block" href="/interaction/${uid}/upstream/${provider}${query}" data-id="upstream-${provider}${purpose === "reset" ? "-reset" : ""}">${verb} với ${UPSTREAM_LABELS[provider]}</a>`,
	)}</div>`;
}

export interface LoginView {
	readonly host: string;
	readonly uid: string;
	readonly csrf: string;
	readonly providers: readonly UpstreamProvider[];
	/** Who is asking: an app name, or a device approval. */
	readonly clientName?: string;
	/** The app registered through DCR: its name is self-declared. */
	readonly externalClient?: boolean;
	readonly forDevice: boolean;
	readonly identifier?: string;
	readonly error?: string;
	readonly notice?: string;
}

export function renderLogin(view: LoginView): string {
	const subtitle = view.forDevice
		? "Đăng nhập để duyệt thiết bị."
		: view.clientName
			? html`Để tiếp tục tới ${clientLabel(view.clientName, view.externalClient === true)}. Một tài khoản hoandat cho Localman và Tunelo.`
			: "Một tài khoản hoandat cho Localman và Tunelo.";
	const body = html`${pageTitle("Đăng nhập", subtitle)}
${maybeAlert("error", view.error)}${maybeAlert("success", view.notice)}
<form class="auth-form" method="post" action="/interaction/${view.uid}/login" novalidate>
${csrfField(view.csrf)}
${upstreamButtons(view.uid, view.providers, "Đăng nhập")}
${view.providers.length > 0 ? html`<div class="divider">hoặc dùng mật khẩu</div>` : ""}
${inputField({ name: "identifier", label: "Email hoặc username", value: view.identifier, autocomplete: "username", placeholder: "ban@example.com", maxlength: 254, autofocus: true })}
<div class="field">
<div class="auth-row"><label class="label" for="f-password">Mật khẩu</label><a class="link" href="/interaction/${view.uid}/forgot" data-id="login-forgot">Quên mật khẩu?</a></div>
<input class="input" id="f-password" name="password" type="password" autocomplete="current-password" required maxlength="256" data-id="input-password">
</div>
${submitButton("Đăng nhập", { block: true, dataId: "login-submit" })}
</form>
<p class="auth-foot">Chưa có tài khoản? <a class="link" href="/interaction/${view.uid}/signup" data-id="login-to-signup">Đăng ký</a></p>
<form method="post" action="/interaction/${view.uid}/abort" class="auth-cancel">${csrfField(view.csrf)}${submitButton("Huỷ đăng nhập", { variant: "minimal", dataId: "login-cancel" })}</form>`;
	return renderPage({ title: "Đăng nhập", body, host: view.host });
}
