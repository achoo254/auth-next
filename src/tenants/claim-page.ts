import { accountCard, emptyState } from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import {
	alertBox,
	csrfField,
	inputField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { type ClaimDocument, claimRecord } from "./tenant-claims.js";
import type { TenantDocument, TenantOwner } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

/** One identity the signed-in account could claim with. */
export interface ClaimIdentity extends TenantOwner {
	/** What the provider said (email, GitHub login), to tell them apart. */
	readonly label: string;
}

export interface ClaimView {
	readonly host: string;
	readonly page: PageContext;
	readonly csrf: string;
	readonly open: boolean;
	readonly serviceIp?: string;
	readonly identities: readonly ClaimIdentity[];
	readonly claims: readonly ClaimDocument[];
	readonly tenants: readonly TenantDocument[];
	readonly notice?: {
		readonly tone: "success" | "error";
		readonly text: string;
	};
}

const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
	claimed: "claim.tenants.claimed",
	active: "claim.tenants.active",
	suspended: "claim.tenants.suspended",
};

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
 */
function dnsRecords(view: ClaimView, claim: ClaimDocument): SafeHtml {
	const { i18n } = view.page;
	const txt = claimRecord(claim);
	const hosts = appHostsFor(claim.domain);
	const ip = view.serviceIp ?? "";
	const addresses = [
		hosts.auth,
		hosts.localman,
		hosts.localmanWildcard,
		hosts.tunnel,
		hosts.tunnelWildcard,
	];
	const dnsOnly = i18n.t("claim.records.dnsOnly");
	return html`<div class="dns-records" data-id="claim-records">
<table>
<caption class="help">${i18n.t("claim.records.hint")}</caption>
<thead><tr><th scope="col">${i18n.t("claim.records.type")}</th><th scope="col">${i18n.t("claim.records.name")}</th><th scope="col">${i18n.t("claim.records.content")}</th><th scope="col">${i18n.t("claim.records.proxy")}</th></tr></thead>
<tbody>
<tr><td>TXT</td><td><code class="copyable host" data-id="claim-txt-name">${hostName(txt.name)}</code></td><td><code class="copyable" data-id="claim-txt-value">${txt.value}</code></td><td></td></tr>
${addresses.map(
	(host) =>
		html`<tr><td>A</td><td><code class="copyable host">${hostName(host)}</code></td><td><code class="copyable host">${ip}</code></td><td>${dnsOnly}</td></tr>`,
)}
</tbody>
</table>
</div>`;
}

function pendingClaim(view: ClaimView, claim: ClaimDocument): SafeHtml {
	const { i18n } = view.page;
	return html`<li class="item-row claim-pending" data-id="claim-${claim._id}"><div>
<p><b>${i18n.t("claim.pending.title", { domain: claim.domain })}</b></p>
<p class="help">${i18n.t("claim.pending.lead")}</p>
${dnsRecords(view, claim)}
<p class="help">${i18n.t("claim.pending.expires", { date: i18n.date(claim.expiresAt) })}</p>
</div>
<form method="post" action="/claim/${claim._id}/verify" class="inline-form">${csrfField(view.csrf)}${submitButton(i18n.t("claim.pending.verify"), { dataId: `claim-verify-${claim._id}` })}</form>
</li>`;
}

function ownedTenant(view: ClaimView, tenant: TenantDocument): SafeHtml {
	const { i18n } = view.page;
	const status = STATUS_KEYS[tenant.status];
	return html`<li class="item-row" data-id="tenant-${tenant.domain}"><div>
<p><b>${tenant.domain}</b></p>
${status ? html`<p class="help" data-id="tenant-status-${tenant.domain}">${i18n.t(status)}</p>` : ""}
</div>
${tenant.status === "suspended" ? "" : html`<form method="post" action="/claim/tenants/${tenant._id}/admin" class="inline-form">${csrfField(view.csrf)}${submitButton(i18n.t("claim.tenants.admin"), { variant: "secondary", dataId: `tenant-admin-${tenant.domain}` })}</form>`}
</li>`;
}

function claimForm(view: ClaimView): SafeHtml {
	const { i18n } = view.page;
	if (!view.open)
		return html`<p class="help" data-id="claim-closed">${i18n.t("claim.unavailable")}</p>`;
	if (view.identities.length === 0) {
		return html`<p class="help" data-id="claim-no-identity">${i18n.t("claim.noIdentity")}</p>`;
	}
	return html`<form method="post" action="/claim" class="auth-form" data-id="claim-form">${csrfField(view.csrf)}
${inputField({ name: "domain", label: i18n.t("claim.form.domain"), help: i18n.t("claim.form.domainHelp"), autocomplete: "off", maxlength: 253 })}
<p class="label">${i18n.t("claim.form.owner")}</p>
${view.identities.map((identity) =>
	submitButton(
		i18n.t("claim.form.ownerOption", {
			provider: UPSTREAM_LABELS[identity.provider],
			name: identity.label,
		}),
		{
			name: "owner",
			value: identity.provider,
			block: true,
			dataId: `claim-start-${identity.provider}`,
		},
	),
)}
</form>`;
}

/** /claim on the primary tenant: start a claim, follow its DNS, open /admin. */
export function renderClaimPage(view: ClaimView): string {
	const { i18n } = view.page;
	const body = html`${pageTitle(i18n.t("claim.title"), i18n.t("claim.lead"))}
${view.notice ? alertBox(view.notice.tone, view.notice.text) : ""}
<div class="account-grid">
${accountCard({ id: "claim-start", icon: accountIcon("apps"), title: i18n.t("claim.form.submit"), description: i18n.t("claim.form.domainHelp"), body: claimForm(view) })}
${
	view.claims.length > 0
		? accountCard({
				id: "claim-pending",
				icon: accountIcon("sessions"),
				title: i18n.t("claim.pending.verify"),
				description: i18n.t("claim.pending.lead"),
				count: view.claims.length,
				body: html`<ul class="item-list">${view.claims.map((claim) => pendingClaim(view, claim))}</ul>`,
			})
		: ""
}
${accountCard({
	id: "claim-tenants",
	icon: accountIcon("profile"),
	title: i18n.t("claim.tenants.title"),
	description: i18n.t("claim.lead"),
	count: view.tenants.length,
	body:
		view.tenants.length > 0
			? html`<ul class="item-list">${view.tenants.map((tenant) => ownedTenant(view, tenant))}</ul>`
			: emptyState("—", "claim-tenants-empty"),
})}
</div>`;
	return renderPage({
		title: i18n.t("claim.title"),
		host: view.host,
		page: view.page,
		layout: "portal",
		body,
	});
}
