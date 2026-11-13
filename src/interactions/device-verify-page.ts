import type { Client, KoaContextWithOIDC, UnknownObject } from "oidc-provider";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { alertBox, pageTitle, submitButton } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { koaPageContext } from "../ui/page-context.js";
import { isMachineAgent, sameIp } from "./device-app-access.js";
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
export function deviceLabel(
	i18n: Translator,
	label: string,
	machine: string | undefined,
): SafeHtml {
	return i18n.rich("device.onMachine", {
		app: html`<code>${label}</code>`,
		machine: html`<b>${machine ?? i18n.t("device.unknownName")}</b>`,
	});
}

/** What approving the agent is for, in one sentence. */
export function agentPurpose(i18n: Translator): SafeHtml {
	return html`<p data-id="device-agent-purpose">${i18n.t("device.agent.purpose")}</p>`;
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
	renderCodeInput(ctx, form, error);
}

/** The code entry form; `hint` says where the code to type is shown. */
function renderCodeInput(
	ctx: KoaContextWithOIDC,
	form: string,
	error?: Error,
	hint?: MessageKey,
): void {
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const action = ctx.oidc.urlFor("code_verification");
	const body = html`${pageTitle(i18n.t("device.input.title"), i18n.t("device.input.subtitle"))}
${inputMessage(i18n, error)}
${hint ? alertBox("info", html`<span data-id="device-agent-type-code">${i18n.t(hint)}</span>`) : ""}
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
 * matches their screen before signing in. The agent's prefilled code is
 * taken only by a browser on the IP that asked for it, so a forwarded link
 * cannot hand someone else's machine the account; elsewhere the user types
 * the code from the machine's terminal.
 */
export async function userCodeConfirmSource(
	ctx: KoaContextWithOIDC,
	form: string,
	client: Client,
	deviceInfo: UnknownObject,
	userCode: string,
): Promise<void> {
	const agent = isMachineAgent(client.clientId);
	if (agent && !sameIp(ctx.ip, deviceIpOf(deviceInfo))) {
		renderCodeInput(ctx, form, undefined, "device.input.agentHint");
		return;
	}
	const page = koaPageContext(ctx);
	const { i18n } = page;
	const action = ctx.oidc.urlFor("code_verification");
	const xsrf = xsrfFromProviderForm(form);
	const label = deviceClientLabel(client.clientId, client.clientName);
	const machine = deviceNameOf(ctx.oidc.deviceCode?.params, deviceInfo);
	const title = i18n.t("device.confirm.title");
	const body = html`${pageTitle(title, i18n.rich("device.confirm.subtitle", { device: deviceLabel(i18n, label, machine) }))}
${agent ? agentPurpose(i18n) : ""}
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
