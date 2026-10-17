import type { Translator } from "../i18n/translator.js";
import { type SafeHtml, html } from "../ui/html.js";
import type { WrongRecords } from "./claim-dns-feedback.js";
import { APP_HOST_KEYS } from "./ownership-records.js";
import { type ClaimDocument, claimRecord } from "./tenant-claims.js";
import { type TenantHosting, appHostsFor } from "./tenant.js";

/** A host name that wraps only after its dots (`<wbr>` copies as nothing). */
function hostName(name: string): SafeHtml {
	const labels = name.split(".");
	return html`${labels.map((label, index) =>
		index < labels.length - 1 ? html`${label}.<wbr>` : html`${label}`,
	)}`;
}

/**
 * The records to add, one row each in the order of a DNS provider's form
 * (type, name, content, proxy). One click selects a whole name or value.
 * A self-hosted claim (ADR 0007) asks for the TXT record only: its hosts
 * point at the owner's own servers.
 */
export function dnsRecords(
	i18n: Translator,
	claim: ClaimDocument,
	serviceIp: string | undefined,
	wrongRecords: WrongRecords | undefined,
): SafeHtml {
	const txt = claimRecord(claim);
	const hosts = appHostsFor(claim.domain);
	const ip = serviceIp ?? "";
	const wrong = wrongRecords?.claimId === claim._id ? wrongRecords.hosts : [];
	const proxy = i18n.t("claim.records.proxyChoice");
	const wrongBadge = html` <span class="badge badge-warning">${i18n.t("claim.records.wrong")}</span>`;
	const addresses =
		claim.hosting === "self"
			? []
			: APP_HOST_KEYS.map(
					(key) =>
						html`<tr data-id="claim-record-${key}"><td>A</td><td><code class="copyable host">${hostName(hosts[key])}</code></td><td><code class="copyable host">${ip}</code></td><td>${proxy}${wrong.includes(key) ? wrongBadge : ""}</td></tr>`,
				);
	return html`<div class="dns-records" data-id="claim-records">
<table>
<caption class="help">${i18n.t("claim.records.hint")}</caption>
<thead><tr><th scope="col">${i18n.t("claim.records.type")}</th><th scope="col">${i18n.t("claim.records.name")}</th><th scope="col">${i18n.t("claim.records.content")}</th><th scope="col">${i18n.t("claim.records.proxy")}</th></tr></thead>
<tbody>
<tr><td>TXT</td><td><code class="copyable host" data-id="claim-txt-name">${hostName(txt.name)}</code></td><td><code class="copyable" data-id="claim-txt-value">${txt.value}</code></td><td></td></tr>
${addresses}
</tbody>
</table>
</div>`;
}

const HOSTING_KEYS = {
	hoandat: {
		title: "claim.hosting.hoandat",
		help: "claim.hosting.hoandatHelp",
	},
	self: { title: "claim.hosting.self", help: "claim.hosting.selfHelp" },
} as const;

/**
 * Where the tenant will run, when the service offers more than one place:
 * radio buttons, the first one checked. A single place needs no question.
 */
export function hostingChoice(
	i18n: Translator,
	offered: readonly TenantHosting[],
): SafeHtml {
	const [only] = offered;
	if (offered.length === 1 && only) {
		return html`<input type="hidden" name="hosting" value="${only}">`;
	}
	return html`<fieldset class="choice-list" data-id="claim-hosting">
<legend class="label">${i18n.t("claim.hosting.label")}</legend>
${offered.map(
	(hosting, index) =>
		html`<label class="choice"><input type="radio" name="hosting" value="${hosting}"${index === 0 ? html` checked` : ""} data-id="claim-hosting-${hosting}"><span><b>${i18n.t(HOSTING_KEYS[hosting].title)}</b><span class="help">${i18n.t(HOSTING_KEYS[hosting].help)}</span></span></label>`,
)}
</fieldset>`;
}
