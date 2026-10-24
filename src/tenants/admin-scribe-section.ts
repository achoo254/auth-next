import {
	type AccountCardState,
	accountCard,
} from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import {
	actionButton,
	csrfField,
	inputField,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import type { PageContext } from "../ui/page-context.js";
import { copyValue, replaceDisclosure } from "./admin-blocks.js";
import type { ScribeKeySummary } from "./scribe-key-settings.js";
import {
	SCRIBE_TRANSCRIPTION_VENDORS,
	SCRIBE_VENDORS,
	SCRIBE_VENDOR_LABELS,
	type ScribeKeyStatus,
	type ScribeVendor,
} from "./scribe-vendors.js";
import type { TenantDocument } from "./tenant-registry.js";

/** The Scribe part of /admin, present when Scribe on tenants is enabled. */
export interface ScribeAdminView {
	readonly keys: readonly ScribeKeySummary[];
	/** SERVICE_IPV4: where `scribe.<domain>` must point. */
	readonly serviceIp?: string;
}

const STATUS_MESSAGES: Readonly<Record<ScribeKeyStatus, MessageKey>> = {
	invalid: "admin.scribe.status.invalid",
	quota: "admin.scribe.status.quota",
	unreadable: "admin.scribe.status.unreadable",
};

const STATUS_BADGES: Readonly<
	Record<ScribeKeyStatus, Pick<AccountCardState, "tone"> & { key: MessageKey }>
> = {
	invalid: { tone: "error", key: "admin.state.refused" },
	quota: { tone: "warning", key: "admin.state.noCredit" },
	unreadable: { tone: "warning", key: "admin.state.reenter" },
};

const USES: Readonly<Record<ScribeVendor, readonly MessageKey[]>> = {
	elevenlabs: ["admin.scribe.use.transcription"],
	openai: ["admin.scribe.use.transcription", "admin.scribe.use.text"],
	gemini: ["admin.scribe.use.transcription", "admin.scribe.use.text"],
	anthropic: ["admin.scribe.use.text"],
};

/** Where the `scribe.` certificate stands, once Scribe is on. */
function certificateLine(page: PageContext, tenant: TenantDocument): SafeHtml {
	const { i18n } = page;
	const certificate = tenant.scribeCertificate;
	if (!tenant.scribe || !certificate) return html``;
	const text =
		certificate.status === "issued"
			? i18n.t("admin.scribe.certificate.issued", {
					date: i18n.date(certificate.issuedAt),
				})
			: certificate.status === "failed"
				? i18n.t("admin.scribe.certificate.failed", {
						error: certificate.lastError ?? "",
						date: i18n.date(certificate.nextAttemptAt),
					})
				: i18n.t("admin.scribe.certificate.pending");
	return html`<p class="help" data-id="admin-scribe-certificate">${text}</p>`;
}

/** On or off, who pays for AI, and the DNS record `scribe.` needs. */
function overview(
	page: PageContext,
	csrf: string,
	tenant: TenantDocument,
	view: ScribeAdminView,
): SafeHtml {
	const { i18n } = page;
	const host = `scribe.${tenant.domain}`;
	const status = tenant.scribe
		? i18n.t("admin.scribe.on", { url: `https://${host}` })
		: i18n.t("admin.scribe.off");
	const record = copyValue(`A ${host} → ${view.serviceIp ?? ""}`);
	return html`<p class="help" data-id="admin-scribe-status">${status}</p>
<p class="alert alert-warning admin-note" data-id="admin-scribe-billing">${i18n.t("admin.scribe.billing")}</p>
${view.serviceIp ? html`<p class="alert alert-info admin-note" data-id="admin-scribe-record">${i18n.rich("admin.scribe.record", { record })}</p>` : ""}
${certificateLine(page, tenant)}
${tenant.scribe ? actionButton("/admin/scribe/dns", csrf, i18n.t("admin.scribe.checkDns"), { dataId: "admin-scribe-check-dns" }) : ""}`;
}

function keyBadge(
	page: PageContext,
	saved: ScribeKeySummary | undefined,
): AccountCardState {
	const { i18n } = page;
	if (!saved) return { tone: "neutral", label: i18n.t("admin.state.notSet") };
	if (!saved.status) {
		return { tone: "success", label: i18n.t("admin.state.saved") };
	}
	const badge = STATUS_BADGES[saved.status];
	return { tone: badge.tone, label: i18n.t(badge.key) };
}

function savedLine(page: PageContext, key: ScribeKeySummary): SafeHtml {
	const { i18n } = page;
	const provider = SCRIBE_VENDOR_LABELS[key.vendor];
	const state = key.status
		? i18n.t(STATUS_MESSAGES[key.status], { provider })
		: i18n.t("admin.scribe.status.valid", { provider });
	return html`<p class="help" data-id="admin-scribe-${key.vendor}-saved">${i18n.t("admin.scribe.saved", { hint: key.hint, date: i18n.date(key.updatedAt) })} <span data-id="admin-scribe-${key.vendor}-state">${state}</span></p>`;
}

/**
 * One provider: its name and state, what Scribe uses it for, the saved
 * key (last 4 characters, what Scribe reported), a field to add or
 * replace it, removal. A key Scribe reported broken, or any key right
 * after a save that failed, shows its field open.
 */
function vendorTile(
	page: PageContext,
	csrf: string,
	vendor: ScribeVendor,
	saved: ScribeKeySummary | undefined,
	reopen: boolean,
): SafeHtml {
	const { i18n } = page;
	const provider = SCRIBE_VENDOR_LABELS[vendor];
	const badge = keyBadge(page, saved);
	const form = html`<form method="post" action="/admin/scribe/${vendor}" class="admin-inline-form">${csrfField(csrf)}
${inputField({ name: "apiKey", id: `f-scribe-${vendor}`, label: i18n.t("admin.scribe.key"), type: "password", autocomplete: "off", maxlength: 300 })}
${submitButton(i18n.t("admin.save"), { dataId: `admin-save-scribe-${vendor}` })}</form>`;
	return html`<section class="admin-vendor" data-id="admin-scribe-${vendor}" aria-labelledby="admin-scribe-${vendor}-name">
<div class="admin-vendor-head"><h5 class="admin-vendor-name" id="admin-scribe-${vendor}-name">${provider}</h5>
<span class="badge badge-${badge.tone}" data-id="admin-scribe-${vendor}-badge">${badge.label}</span></div>
<ul class="admin-uses">${USES[vendor].map((use) => html`<li>${i18n.t(use)}</li>`)}</ul>
${saved ? savedLine(page, saved) : ""}
${saved ? replaceDisclosure(i18n.t("admin.scribe.change"), form, `admin-scribe-${vendor}-change`, reopen || saved.status !== undefined) : form}
${saved ? actionButton(`/admin/scribe/${vendor}/remove`, csrf, i18n.t("admin.oauth.remove"), { variant: "danger-outline", dataId: `admin-remove-scribe-${vendor}` }) : ""}
</section>`;
}

/** Scribe on this domain, across the whole row: overview, then one tile per provider. */
export function scribeAdminCard(
	page: PageContext,
	csrf: string,
	tenant: TenantDocument,
	view: ScribeAdminView,
	reopen: boolean,
): SafeHtml {
	const { i18n } = page;
	const transcription = SCRIBE_TRANSCRIPTION_VENDORS.map(
		(vendor) => SCRIBE_VENDOR_LABELS[vendor],
	).join(", ");
	return accountCard({
		id: "admin-scribe",
		icon: accountIcon("apps"),
		title: i18n.t("admin.scribe.title"),
		description: i18n.t("admin.scribe.help", {
			domain: tenant.domain,
			providers: transcription,
		}),
		state: tenant.scribe
			? { tone: "success", label: i18n.t("admin.state.on") }
			: { tone: "neutral", label: i18n.t("admin.state.off") },
		wide: true,
		body: html`${overview(page, csrf, tenant, view)}
<div class="admin-keys-head"><h4 class="label">${i18n.t("admin.scribe.keys")}</h4>
<p class="help">${i18n.t("admin.scribe.sealed")}</p></div>
<div class="admin-vendors">${SCRIBE_VENDORS.map((vendor) =>
			vendorTile(
				page,
				csrf,
				vendor,
				view.keys.find((key) => key.vendor === vendor),
				reopen,
			),
		)}</div>`,
	});
}
