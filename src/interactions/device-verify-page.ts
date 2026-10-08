import type { Client, KoaContextWithOIDC, UnknownObject } from "oidc-provider";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { describeScopes } from "./consent-page.js";
import { deviceClientLabel, deviceIpOf, deviceNameOf } from "./device-info.js";
import { sendKoaPage, xsrfFromProviderForm } from "./koa-page.js";

const INPUT_ERRORS: Readonly<Record<string, string>> = {
	NoCodeError: "Hãy nhập mã đang hiện trên máy của bạn.",
	NotFoundError: "Mã không đúng. Kiểm tra lại mã trên máy của bạn.",
	ExpiredError:
		"Mã đã hết hạn. Chạy lại lệnh đăng nhập trên máy để lấy mã mới.",
	AlreadyUsedError: "Mã này đã được dùng. Chạy lại lệnh đăng nhập trên máy.",
	AbortedError: "Đã từ chối. Máy kia sẽ không được cấp quyền.",
};

function inputMessage(error: Error | undefined): SafeHtml {
	if (!error) return html``;
	const known = INPUT_ERRORS[error.name];
	return known
		? alertBox(error.name === "AbortedError" ? "info" : "error", known)
		: alertBox("error", "Không xử lý được yêu cầu. Thử lại sau ít phút.");
}

/**
 * `features.deviceFlow.userCodeInputSource`. The form also sends
 * `confirm=yes`: the explicit "allow?" question comes after sign-in, on the
 * approval page, so there is no separate confirm step here.
 */
export async function userCodeInputSource(
	ctx: KoaContextWithOIDC,
	form: string,
	_out?: unknown,
	error?: Error,
): Promise<void> {
	const action = ctx.oidc.urlFor("code_verification");
	const body = html`${pageTitle("Đăng nhập thiết bị", "Nhập mã đang hiện trên máy (ví dụ trong cửa sổ dòng lệnh của tunelo).")}
${inputMessage(error)}
<form class="auth-form" method="post" action="${action}">
<input type="hidden" name="xsrf" value="${xsrfFromProviderForm(form)}">
<input type="hidden" name="confirm" value="yes">
<div class="field"><label class="label" for="user_code">Mã thiết bị</label>
<input class="input input-code-entry" id="user_code" name="user_code" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus placeholder="XXXX-XXXX" data-id="device-user-code"></div>
${submitButton("Tiếp tục", { block: true, dataId: "device-continue" })}
</form>`;
	sendKoaPage(
		ctx,
		renderPage({ title: "Đăng nhập thiết bị", body, host: ctx.host }),
	);
}

/**
 * `features.deviceFlow.userCodeConfirmSource`: reached from the link with
 * the code prefilled (verification_uri_complete). The user checks the code
 * matches their screen before signing in.
 */
export async function userCodeConfirmSource(
	ctx: KoaContextWithOIDC,
	form: string,
	client: Client,
	deviceInfo: UnknownObject,
	userCode: string,
): Promise<void> {
	const action = ctx.oidc.urlFor("code_verification");
	const xsrf = xsrfFromProviderForm(form);
	const label = deviceClientLabel(client.clientId, client.clientName);
	const body = html`${pageTitle("Kiểm tra mã thiết bị", html`Yêu cầu từ <code>${label}</code> trên máy <b>${deviceNameOf(ctx.oidc.deviceCode?.params, deviceInfo)}</b>.`)}
<p class="device-code" data-id="device-code">${userCode}</p>
<p class="help">Chỉ tiếp tục nếu mã trên khớp với mã đang hiện trên máy của bạn.</p>
<div class="auth-form">
<form method="post" action="${action}"><input type="hidden" name="xsrf" value="${xsrf}"><input type="hidden" name="user_code" value="${userCode}"><input type="hidden" name="confirm" value="yes">${submitButton("Mã khớp, tiếp tục", { block: true, dataId: "device-confirm" })}</form>
<form method="post" action="${action}"><input type="hidden" name="xsrf" value="${xsrf}"><input type="hidden" name="user_code" value="${userCode}"><input type="hidden" name="abort" value="yes">${submitButton("Huỷ", { block: true, variant: "minimal", dataId: "device-abort" })}</form>
</div>`;
	sendKoaPage(
		ctx,
		renderPage({ title: "Kiểm tra mã thiết bị", body, host: ctx.host }),
	);
}

/** `features.deviceFlow.successSource`. */
export async function deviceSuccessSource(
	ctx: KoaContextWithOIDC,
): Promise<void> {
	const client = ctx.oidc.client;
	const code = ctx.oidc.deviceCode;
	const label = client
		? deviceClientLabel(client.clientId, client.clientName)
		: "thiết bị";
	const body = html`${pageTitle("Đã cho phép", html`<code>${label}</code> trên máy <b>${deviceNameOf(code?.params, code?.deviceInfo)}</b> đã đăng nhập vào tài khoản của bạn.`)}
${alertBox("success", "Quay lại cửa sổ dòng lệnh, máy sẽ tự tiếp tục. Bạn có thể đóng trang này.")}
<p class="auth-foot"><a class="link" href="/account" data-id="device-success-account">Quản lý thiết bị ở trang tài khoản</a></p>`;
	sendKoaPage(
		ctx,
		renderPage({ title: "Đã cho phép thiết bị", body, host: ctx.host }),
	);
}

/** Stored codes are normalised (XXXXXXXX); show them as on the device. */
function formatUserCode(code: string): string {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export interface DeviceApprovalView {
	readonly host: string;
	readonly csrf: string;
	readonly uid: string;
	readonly clientId: string;
	readonly clientName?: string;
	readonly params: UnknownObject | undefined;
	readonly deviceInfo: UnknownObject | undefined;
	readonly userCode?: string;
	readonly scopes: readonly string[];
	readonly username: string;
}

/** The "Cho phép tunelo trên máy …?" page, shown after sign-in. */
export function renderDeviceApproval(view: DeviceApprovalView): string {
	const label = deviceClientLabel(view.clientId, view.clientName);
	const machine = deviceNameOf(view.params, view.deviceInfo);
	const ip = deviceIpOf(view.deviceInfo);
	const body = html`${pageTitle("Duyệt thiết bị", html`Đang đăng nhập là <b>@${view.username}</b>.`)}
<p class="device-question" data-id="device-question">Cho phép <code>${label}</code> trên máy <b>${machine}</b>?</p>
${view.userCode ? html`<p class="help">Mã: <code data-id="device-approval-code">${formatUserCode(view.userCode)}</code>${ip ? html` · yêu cầu từ IP <code>${ip}</code>` : ""}</p>` : ""}
<ul class="scope-list">${describeScopes(view.scopes).map((text) => html`<li>${text}</li>`)}</ul>
<div class="auth-form">
<form method="post" action="/interaction/${view.uid}/consent">${csrfField(view.csrf)}${submitButton("Cho phép", { block: true, dataId: "device-allow" })}</form>
<form method="post" action="/interaction/${view.uid}/abort">${csrfField(view.csrf)}${submitButton("Từ chối", { block: true, variant: "secondary", dataId: "device-deny" })}</form>
</div>`;
	return renderPage({ title: "Duyệt thiết bị", body, host: view.host });
}
