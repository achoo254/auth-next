import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { clientLabel } from "./client-label.js";

/** Shown instead of the buttons when no Google/GitHub app is configured. */
export const NO_PROVIDER_MESSAGE =
	"Đăng nhập bằng Google và GitHub đang tạm tắt, nên chưa đăng nhập hay đăng ký được. Thử lại sau.";

/**
 * "Đăng nhập với Google" style buttons for the configured providers, or the
 * unavailable notice when there is none (the only ways in are these).
 */
export function upstreamButtons(
	uid: string,
	providers: readonly UpstreamProvider[],
	verb: string,
): SafeHtml {
	if (providers.length === 0) {
		return html`<div data-id="upstream-unavailable">${alertBox("error", NO_PROVIDER_MESSAGE)}</div>`;
	}
	return html`<div class="oauth">${providers.map(
		(provider) =>
			html`<a class="btn btn-secondary btn-block" href="/interaction/${uid}/upstream/${provider}" data-id="upstream-${provider}">${verb} với ${UPSTREAM_LABELS[provider]}</a>`,
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
}

export function renderLogin(view: LoginView): string {
	const subtitle = view.forDevice
		? "Đăng nhập để duyệt thiết bị."
		: view.clientName
			? html`Để tiếp tục tới ${clientLabel(view.clientName, view.externalClient === true)}. Một tài khoản hoandat cho Localman và Tunelo.`
			: "Một tài khoản hoandat cho Localman và Tunelo.";
	const body = html`${pageTitle("Đăng nhập", subtitle)}
<div class="auth-form">
${upstreamButtons(view.uid, view.providers, "Đăng nhập")}
</div>
${view.providers.length > 0 ? html`<p class="auth-foot" data-id="login-first-time">Lần đầu đăng nhập bằng Google hoặc GitHub sẽ tạo tài khoản hoandat mới.</p>` : ""}
<form method="post" action="/interaction/${view.uid}/abort" class="auth-cancel">${csrfField(view.csrf)}${submitButton("Huỷ đăng nhập", { variant: "minimal", dataId: "login-cancel" })}</form>`;
	return renderPage({ title: "Đăng nhập", body, host: view.host });
}

export interface SignupView {
	readonly host: string;
	readonly uid: string;
	readonly providers: readonly UpstreamProvider[];
}

/** `prompt=create`: the same Google/GitHub choice, worded as a sign-up. */
export function renderSignup(view: SignupView): string {
	const body = html`${pageTitle("Tạo tài khoản hoandat", "Dùng chung cho Localman và Tunelo. Đăng ký bằng Google hoặc GitHub; hoandat không dùng mật khẩu và không gửi email.")}
<div class="auth-form">
${upstreamButtons(view.uid, view.providers, "Đăng ký")}
</div>
<p class="auth-foot">Đã có tài khoản? <a class="link" href="/interaction/${view.uid}/login" data-id="signup-to-login">Đăng nhập</a></p>`;
	return renderPage({ title: "Đăng ký", body, host: view.host });
}
