import type { UpstreamProvider } from "../accounts/user-model.js";
import {
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { upstreamButtons } from "./login-page.js";

export interface ForgotView {
	readonly host: string;
	readonly uid: string;
	readonly csrf: string;
	readonly providers: readonly UpstreamProvider[];
	readonly telegramEnabled: boolean;
	readonly identifier?: string;
	readonly error?: string;
	readonly notice?: string;
}

/** The three ways back in without email: code, Telegram, Google/GitHub. */
export function renderForgot(view: ForgotView): string {
	const action = (path: string): string =>
		`/interaction/${view.uid}/forgot/${path}`;
	const body = html`${pageTitle("Quên mật khẩu", "hoandat không gửi email. Chọn một cách để vào lại tài khoản.")}
${maybeAlert("error", view.error)}${maybeAlert("success", view.notice)}
<section class="option-block" data-id="forgot-recovery">
<h2 class="section-title">Dùng mã khôi phục</h2>
<p class="help">Một trong 8 mã bạn lưu khi đăng ký. Mỗi mã dùng được một lần.</p>
<form class="auth-form" method="post" action="${action("recovery")}" novalidate>
${csrfField(view.csrf)}
${inputField({ name: "identifier", label: "Email hoặc username", value: view.identifier, autocomplete: "username", maxlength: 254 })}
${inputField({ name: "code", label: "Mã khôi phục", placeholder: "xxxx-xxxx", autocomplete: "off", maxlength: 20 })}
${inputField({ name: "password", label: "Mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256, help: "Ít nhất 7 ký tự." })}
${inputField({ name: "password_confirm", label: "Nhập lại mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256 })}
${submitButton("Đặt lại mật khẩu và đăng nhập", { block: true, dataId: "forgot-recovery-submit" })}
</form>
</section>
${
	view.telegramEnabled
		? html`<section class="option-block" data-id="forgot-telegram">
<h2 class="section-title">Nhận link qua Telegram</h2>
<p class="help">Nếu tài khoản đã liên kết Telegram, bot hoandat gửi link đặt lại mật khẩu, dùng được một lần trong 15 phút.</p>
<form class="auth-form" method="post" action="${action("telegram")}" novalidate>
${csrfField(view.csrf)}
${inputField({ id: "f-telegram-identifier", name: "identifier", label: "Email hoặc username", value: view.identifier, autocomplete: "username", maxlength: 254 })}
${submitButton("Gửi link qua Telegram", { block: true, variant: "secondary", dataId: "forgot-telegram-submit" })}
</form>
</section>`
		: ""
}
${
	view.providers.length > 0
		? html`<section class="option-block" data-id="forgot-upstream">
<h2 class="section-title">Dùng Google hoặc GitHub đã liên kết</h2>
<p class="help">Đăng nhập bằng tài khoản đã liên kết rồi đặt mật khẩu mới.</p>
${upstreamButtons(view.uid, view.providers, "Tiếp tục", "reset")}
</section>`
		: ""
}
<p class="auth-foot"><a class="link" href="/interaction/${view.uid}" data-id="forgot-back">Quay lại đăng nhập</a></p>`;
	return renderPage({ title: "Quên mật khẩu", body, host: view.host });
}
