import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import {
	alertBox,
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";

interface UpstreamPageBase {
	readonly host: string;
	readonly uid: string;
	readonly csrf: string;
	readonly provider: UpstreamProvider;
	readonly email: string;
	readonly error?: string;
}

/** New account through Google/GitHub: only the username is left to choose. */
export function renderChooseUsername(
	view: UpstreamPageBase & {
		readonly suggestion: string;
		/** An unverified account holds this email and will lose it. */
		readonly reclaiming: boolean;
	},
): string {
	const label = UPSTREAM_LABELS[view.provider];
	const body = html`${pageTitle("Chọn username", html`Tạo tài khoản hoandat bằng ${label} cho <b>${view.email}</b> (đã xác minh).`)}
${maybeAlert("error", view.error)}
${
	view.reclaiming
		? alertBox(
				"warning",
				html`Email này đang gắn với một tài khoản hoandat khác nhưng chưa ai xác minh. Nếu đó là tài khoản của bạn, hãy <a class="link" href="/interaction/${view.uid}">đăng nhập bằng mật khẩu</a> rồi liên kết ${label} ở trang tài khoản. Nếu tiếp tục, email chuyển sang tài khoản mới; tài khoản kia vẫn đăng nhập được bằng username.`,
			)
		: ""
}
<form class="auth-form" method="post" action="/interaction/${view.uid}/upstream/signup" novalidate>
${csrfField(view.csrf)}
${inputField({ name: "username", label: "Username", value: view.suggestion, autocomplete: "username", minlength: 3, maxlength: 30, pattern: "[a-z0-9_]{3,30}", autofocus: true, help: "3–30 ký tự: chữ thường, số và dấu gạch dưới. Người khác mời bạn bằng username này." })}
${submitButton("Tạo tài khoản", { block: true, dataId: "upstream-signup-submit" })}
</form>
<p class="auth-foot"><a class="link" href="/interaction/${view.uid}" data-id="upstream-signup-back">Quay lại đăng nhập</a></p>`;
	return renderPage({ title: "Chọn username", body, host: view.host });
}

/** A username guess from the email's local part, e.g. "Minh.Anh" → "minh_anh". */
export function suggestUsername(email: string): string {
	const local = email.split("@")[0] ?? "";
	const cleaned = local
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 30);
	return cleaned.length >= 3 ? cleaned : `${cleaned}_user`.slice(0, 30);
}
