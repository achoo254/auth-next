import type { Client, KoaContextWithOIDC, UnknownObject } from "oidc-provider";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, koaPageContext } from "../ui/page-context.js";
import { describeScopes } from "./consent-page.js";
import { deviceClientLabel, deviceIpOf, deviceNameOf } from "./device-info.js";
import { sendKoaPage, xsrfFromProviderForm } from "./koa-page.js";

const INPUT_ERRORS: ReadonlyMap<string, MessageKey> = new Map([
	["NoCodeError", "device.error.noCode"],
	["NotFoundError", "device.error.notFound"],
	["ExpiredError", "device.error.expired"],
	["AlreadyUsedError", "device.error.used"],
	["AbortedError", "device.error.aborted"],
]);

function inputMessage(i18n: Translator, error: Error | undefined): SafeHtml {
	if (!error) return html``;
	const known = INPUT_ERRORS.get(error.name);
	return known
		? alertBox(error.name === "AbortedError" ? "info" : "error", i18n.t(known))
		: alertBox("error", i18n.t("device.error.other"));
}

/** "tunelo on <machine>", the machine bold. */
function deviceLabel(
	i18n: Translator,
	label: string,
	machine: string | undefined,
): SafeHtml {
	return i18n.rich("device.onMachine", {
		app: html`<code>${label}</code>`,
		machine: html`<b>${machine ?? i18n.t("device.unknownName")}</b>`,
	});
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
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const action = ctx.oidc.urlFor("code_verification");
	const body = html`${pageTitle(i18n.t("device.input.title"), i18n.t("device.input.subtitle"))}
${inputMessage(i18n, error)}
<form class="auth-form" method="post" action="${action}">
<input type="hidden" name="xsrf" value="${xsrfFromProviderForm(form)}">
<input type="hidden" name="confirm" value="yes">
<div class="field"><label class="label" for="user_code">${i18n.t("device.input.label")}</label>
<input class="input input-code-entry" id="user_code" name="user_code" autocomplete="off" autocapitalize="characters" spellcheck="false" required autofocus placeholder="XXXX-XXXX" data-id="device-user-code"></div>
${submitButton(i18n.t("common.continue"), { block: true, dataId: "device-continue" })}
</form>`;
	const title = i18n.t("device.input.title");
	sendKoaPage(ctx, renderPage({ title, body, page }));
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
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const action = ctx.oidc.urlFor("code_verification");
	const xsrf = xsrfFromProviderForm(form);
	const label = deviceClientLabel(client.clientId, client.clientName);
	const machine = deviceNameOf(ctx.oidc.deviceCode?.params, deviceInfo);
	const title = i18n.t("device.confirm.title");
	const body = html`${pageTitle(title, i18n.rich("device.confirm.subtitle", { device: deviceLabel(i18n, label, machine) }))}
<p class="device-code" data-id="device-code">${userCode}</p>
<p class="help">${i18n.t("device.confirm.help")}</p>
<div class="auth-form">
<form method="post" action="${action}"><input type="hidden" name="xsrf" value="${xsrf}"><input type="hidden" name="user_code" value="${userCode}"><input type="hidden" name="confirm" value="yes">${submitButton(i18n.t("device.confirm.match"), { block: true, dataId: "device-confirm" })}</form>
<form method="post" action="${action}"><input type="hidden" name="xsrf" value="${xsrf}"><input type="hidden" name="user_code" value="${userCode}"><input type="hidden" name="abort" value="yes">${submitButton(i18n.t("common.cancel"), { block: true, variant: "minimal", dataId: "device-abort" })}</form>
</div>`;
	sendKoaPage(ctx, renderPage({ title, body, page }));
}

/** `features.deviceFlow.successSource`. */
export async function deviceSuccessSource(
	ctx: KoaContextWithOIDC,
): Promise<void> {
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const client = ctx.oidc.client;
	const code = ctx.oidc.deviceCode;
	const label = client
		? deviceClientLabel(client.clientId, client.clientName)
		: i18n.t("device.genericLabel");
	const machine = deviceNameOf(code?.params, code?.deviceInfo);
	const body = html`${pageTitle(i18n.t("device.success.title"), i18n.rich("device.success.subtitle", { device: deviceLabel(i18n, label, machine) }))}
${alertBox("success", i18n.t("device.success.alert"))}
<p class="auth-foot"><a class="link" href="/account" data-id="device-success-account">${i18n.t("device.success.manage")}</a></p>`;
	const title = i18n.t("device.success.pageTitle");
	sendKoaPage(ctx, renderPage({ title, body, page }));
}

/** Stored codes are normalised (XXXXXXXX); show them as on the device. */
function formatUserCode(code: string): string {
	return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export interface DeviceApprovalView {
	readonly page: PageContext;
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

/** The "Allow tunelo on …?" page, shown after sign-in. */
export function renderDeviceApproval(view: DeviceApprovalView): string {
	const { i18n } = view.page;
	const label = deviceClientLabel(view.clientId, view.clientName);
	const machine = deviceNameOf(view.params, view.deviceInfo);
	const ip = deviceIpOf(view.deviceInfo);
	const title = i18n.t("device.approve.title");
	const body = html`${pageTitle(title, i18n.rich("common.signedInAs", { username: html`<b>@${view.username}</b>` }))}
<p class="device-question" data-id="device-question">${i18n.rich("device.approve.question", { device: deviceLabel(i18n, label, machine) })}</p>
${view.userCode ? html`<p class="help">${i18n.rich("device.approve.code", { code: html`<code data-id="device-approval-code">${formatUserCode(view.userCode)}</code>` })}${ip ? html` · ${i18n.rich("device.approve.ip", { ip: html`<code>${ip}</code>` })}` : ""}</p>` : ""}
<ul class="scope-list">${describeScopes(i18n, view.scopes).map((text) => html`<li>${text}</li>`)}</ul>
<div class="auth-form">
<form method="post" action="/interaction/${view.uid}/consent">${csrfField(view.csrf)}${submitButton(i18n.t("consent.allow"), { block: true, dataId: "device-allow" })}</form>
<form method="post" action="/interaction/${view.uid}/abort">${csrfField(view.csrf)}${submitButton(i18n.t("consent.deny"), { block: true, variant: "secondary", dataId: "device-deny" })}</form>
</div>`;
	return renderPage({ title, body, page: view.page });
}
