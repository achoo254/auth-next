import { recoveryCodesText } from "../accounts/recovery-codes.js";
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

export interface SignupView {
	readonly host: string;
	readonly uid: string;
	readonly csrf: string;
	readonly providers: readonly UpstreamProvider[];
	readonly email?: string;
	readonly username?: string;
	readonly error?: string;
}

export function renderSignup(view: SignupView): string {
	const body = html`${pageTitle("Tạo tài khoản hoandat", "Dùng chung cho Localman và Tunelo. hoandat không gửi email.")}
${maybeAlert("error", view.error)}
<form class="auth-form" method="post" action="/interaction/${view.uid}/signup" novalidate>
${csrfField(view.csrf)}
${upstreamButtons(view.uid, view.providers, "Đăng ký")}
${view.providers.length > 0 ? html`<div class="divider">hoặc dùng email</div>` : ""}
${inputField({ name: "email", label: "Email", type: "email", value: view.email, autocomplete: "email", placeholder: "ban@example.com", maxlength: 254, autofocus: true, help: "Dùng để đăng nhập. Email gõ tay ở trạng thái chưa xác minh cho tới khi bạn liên kết Google hoặc GitHub." })}
${inputField({ name: "username", label: "Username", value: view.username, autocomplete: "username", placeholder: "minhanh", minlength: 3, maxlength: 30, pattern: "[a-z0-9_]{3,30}", help: "3–30 ký tự: chữ thường, số và dấu gạch dưới. Người khác mời bạn bằng username này." })}
${inputField({ name: "password", label: "Mật khẩu", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256, help: "Ít nhất 7 ký tự." })}
${inputField({ name: "password_confirm", label: "Nhập lại mật khẩu", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256 })}
${submitButton("Tạo tài khoản", { block: true, dataId: "signup-submit" })}
</form>
<p class="auth-foot">Đã có tài khoản? <a class="link" href="/interaction/${view.uid}" data-id="signup-to-login">Đăng nhập</a></p>`;
	return renderPage({ title: "Đăng ký", body, host: view.host });
}

export interface RecoveryCodesView {
	readonly host: string;
	readonly csrf: string;
	/** Form target once the user confirms the codes are saved. */
	readonly action: string;
	readonly username: string;
	readonly codes: readonly string[];
	readonly continueLabel: string;
	readonly intro?: string;
}

/** Shown once, right after the codes are generated; never again. */
export function renderRecoveryCodes(view: RecoveryCodesView): string {
	const download = `data:text/plain;charset=utf-8,${encodeURIComponent(
		recoveryCodesText(view.username, view.codes),
	)}`;
	const body = html`${pageTitle("Lưu mã khôi phục", view.intro ?? "hoandat không gửi email. Nếu quên mật khẩu, mỗi mã dưới đây dùng được một lần để đặt lại.")}
${
	view.codes.length > 0
		? html`<ol class="recovery-codes" data-id="recovery-codes">${view.codes.map((code) => html`<li><code>${code}</code></li>`)}</ol>
<div class="row-actions"><a class="btn btn-secondary" href="${download}" download="hoandat-recovery-codes-${view.username}.txt" data-id="recovery-download">Tải về (.txt)</a></div>`
		: ""
}
<form class="auth-form" method="post" action="${view.action}">
${csrfField(view.csrf)}
<label class="check-row"><input type="checkbox" name="saved" value="yes" required data-id="recovery-saved"> Tôi đã lưu mã ở nơi an toàn</label>
${submitButton(view.continueLabel, { block: true, dataId: "recovery-continue" })}
</form>
<p class="help">Mã chỉ hiện một lần. Bạn có thể tạo bộ mã mới ở trang tài khoản (bộ cũ sẽ hết hiệu lực).</p>`;
	return renderPage({ title: "Mã khôi phục", body, host: view.host });
}
