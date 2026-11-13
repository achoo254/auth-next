import type { UnknownObject } from "oidc-provider";
import { csrfField, pageTitle, submitButton } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { describeScopes } from "./consent-page.js";
import {
	appAccessBlock,
	isMachineAgent,
	requestOrigin,
} from "./device-app-access.js";
import { deviceClientLabel, deviceIpOf, deviceNameOf } from "./device-info.js";
import { agentPurpose, deviceLabel } from "./device-verify-page.js";

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
	/** IP of the browser approving, compared with the device's for the agent. */
	readonly approverIp?: string;
}

/** The "Allow tunelo on …?" page, shown after sign-in. */
export function renderDeviceApproval(view: DeviceApprovalView): string {
	const { i18n } = view.page;
	const label = deviceClientLabel(view.clientId, view.clientName);
	const machine = deviceNameOf(view.params, view.deviceInfo);
	const ip = deviceIpOf(view.deviceInfo);
	const agent = isMachineAgent(view.clientId);
	const title = i18n.t("device.approve.title");
	const signedInAs = i18n.rich("common.signedInAs", {
		username: html`<b>@${view.username}</b>`,
	});
	const question = html`<p class="device-question" data-id="device-question">${i18n.rich("device.approve.question", { device: deviceLabel(i18n, label, machine) })}</p>`;
	const code = view.userCode
		? html`<p class="help">${i18n.rich("device.approve.code", { code: html`<code data-id="device-approval-code">${formatUserCode(view.userCode)}</code>` })}${ip && !agent ? html` · ${i18n.rich("device.approve.ip", { ip: html`<code>${ip}</code>` })}` : ""}</p>`
		: "";
	const actions = html`<div class="auth-form device-actions">
<form method="post" action="/interaction/${view.uid}/consent">${csrfField(view.csrf)}${submitButton(i18n.t("consent.allow"), { block: true, dataId: "device-allow" })}</form>
<form method="post" action="/interaction/${view.uid}/abort">${csrfField(view.csrf)}${submitButton(i18n.t("consent.deny"), { block: true, variant: "secondary", dataId: "device-deny" })}</form>
</div>`;
	const body = agent
		? html`<div class="device-approval">
${pageTitle(title, signedInAs)}
<section class="device-request">
${question}
${agentPurpose(i18n)}
${requestOrigin(i18n, machine, ip, view.approverIp)}
${code}
</section>
${appAccessBlock(i18n, view.scopes)}
${actions}
</div>`
		: html`${pageTitle(title, signedInAs)}
${question}
${code}
<ul class="scope-list">${describeScopes(i18n, view.scopes).map((text) => html`<li>${text}</li>`)}</ul>
${actions}`;
	return renderPage({
		title,
		body,
		page: view.page,
		...(agent ? { layout: "wide" as const, stylesheets: ["device.css"] } : {}),
	});
}
