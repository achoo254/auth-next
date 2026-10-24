import { accountCard } from "../account-portal/account-card.js";
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

const USES: Readonly<Record<ScribeVendor, MessageKey>> = {
	elevenlabs: "admin.scribe.uses.transcription",
	openai: "admin.scribe.uses.both",
	gemini: "admin.scribe.uses.both",
	anthropic: "admin.scribe.uses.text",
};

function overview(
	page: PageContext,
	tenant: TenantDocument,
	view: ScribeAdminView,
): SafeHtml {
	const { i18n } = page;
	const host = `scribe.${tenant.domain}`;
	const status = tenant.scribe
		? i18n.t("admin.scribe.on", { url: `https://${host}` })
		: i18n.t("admin.scribe.off");
	const record = html`<code class="mono">A ${host} → ${view.serviceIp ?? ""}</code>`;
	return html`<p class="help" data-id="admin-scribe-status">${status}</p>
<p class="help" data-id="admin-scribe-billing"><strong>${i18n.t("admin.scribe.billing")}</strong></p>
${view.serviceIp ? html`<p class="help" data-id="admin-scribe-record">${i18n.rich("admin.scribe.record", { record })}</p>` : ""}`;
}

function savedLine(page: PageContext, key: ScribeKeySummary): SafeHtml {
	const { i18n } = page;
	const provider = SCRIBE_VENDOR_LABELS[key.vendor];
	const state = key.status
		? i18n.t(STATUS_MESSAGES[key.status], { provider })
		: i18n.t("admin.scribe.status.valid", { provider });
	return html`<p class="help" data-id="admin-scribe-${key.vendor}-saved">${i18n.t("admin.scribe.saved", { hint: key.hint, date: i18n.date(key.updatedAt) })} <span data-id="admin-scribe-${key.vendor}-state">${state}</span></p>`;
}

function vendorBlock(
	page: PageContext,
	csrf: string,
	vendor: ScribeVendor,
	saved: ScribeKeySummary | undefined,
): SafeHtml {
	const { i18n } = page;
	const provider = SCRIBE_VENDOR_LABELS[vendor];
	return html`<div class="field" data-id="admin-scribe-${vendor}">
<p class="label">${i18n.t("admin.scribe.keyTitle", { provider })}</p>
<p class="help">${i18n.t(USES[vendor])}</p>
${saved ? savedLine(page, saved) : ""}
<form method="post" action="/admin/scribe/${vendor}" class="auth-form">${csrfField(csrf)}
${inputField({ name: "apiKey", id: `f-scribe-${vendor}`, label: i18n.t("admin.scribe.key"), type: "password", autocomplete: "off", maxlength: 300 })}
${submitButton(i18n.t("admin.save"), { dataId: `admin-save-scribe-${vendor}` })}</form>
${saved ? actionButton(`/admin/scribe/${vendor}/remove`, csrf, i18n.t("admin.oauth.remove"), { variant: "danger", dataId: `admin-remove-scribe-${vendor}` }) : ""}
</div>`;
}

/**
 * Scribe on this domain: on or off, the DNS record it needs, who pays for
 * AI, and one row per provider (last 4 characters of a saved key, what
 * Scribe reported about it, a field to replace it, removal).
 */
export function scribeAdminCard(
	page: PageContext,
	csrf: string,
	tenant: TenantDocument,
	view: ScribeAdminView,
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
		body: html`${overview(page, tenant, view)}
<p class="help">${i18n.t("admin.scribe.sealed")}</p>
${SCRIBE_VENDORS.map((vendor) =>
	vendorBlock(
		page,
		csrf,
		vendor,
		view.keys.find((key) => key.vendor === vendor),
	),
)}`,
	});
}
