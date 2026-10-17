import { accountCard, emptyState } from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import { DOMAIN_GUIDE_PATH } from "../guide/domain-guide-link.js";
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
import type { WrongRecords } from "./claim-dns-feedback.js";
import { dnsRecords, hostingChoice } from "./claim-records.js";
import type { ClaimDocument } from "./tenant-claims.js";
import {
	type TenantDocument,
	type TenantOwner,
	isSelfHosted,
} from "./tenant-registry.js";
import type { TenantHosting } from "./tenant.js";

/** One identity the signed-in account could claim with. */
export interface ClaimIdentity extends TenantOwner {
	/** What the provider said (email, GitHub login), to tell them apart. */
	readonly label: string;
}

export interface ClaimView {
	readonly host: string;
	readonly page: PageContext;
	readonly csrf: string;
	/** Where new tenants can run; none closes claims. */
	readonly hostings: readonly TenantHosting[];
	readonly serviceIp?: string;
	readonly identities: readonly ClaimIdentity[];
	readonly claims: readonly ClaimDocument[];
	readonly tenants: readonly TenantDocument[];
	/** Records the last DNS check found wrong, marked in their claim's table. */
	readonly wrongRecords?: WrongRecords;
	readonly notice?: {
		readonly tone: "success" | "error";
		readonly text: string;
	};
}

const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
	claimed: "claim.tenants.claimed",
	active: "claim.tenants.active",
	suspended: "claim.tenants.suspended",
	enrolling: "claim.tenants.enrolling",
	self_hosted: "claim.tenants.selfHosted",
	migrating: "claim.tenants.migrating",
};

function pendingClaim(view: ClaimView, claim: ClaimDocument): SafeHtml {
	const { i18n } = view.page;
	return html`<li class="item-row claim-pending" data-id="claim-${claim._id}"><div>
<p><b>${i18n.t("claim.pending.title", { domain: claim.domain })}</b></p>
<p class="help">${i18n.t(claim.hosting === "self" ? "claim.pending.leadSelf" : "claim.pending.lead")}</p>
${dnsRecords(i18n, claim, view.serviceIp, view.wrongRecords)}
<p class="help">${i18n.t("claim.pending.expires", { date: i18n.date(claim.expiresAt) })}</p>
</div>
<form method="post" action="/claim/${claim._id}/verify" class="inline-form">${csrfField(view.csrf)}${submitButton(i18n.t("claim.pending.verify"), { dataId: `claim-verify-${claim._id}` })}</form>
</li>`;
}

/**
 * What the owner can do with a tenant from here: open its /admin; download
 * the bundle its install needs while it waits for one (self-hosted claim or
 * a move); start moving an active one to its own servers, or cancel the
 * move (ADR 0007 §7, offered with the self-hosted mode).
 */
function tenantAction(view: ClaimView, tenant: TenantDocument): SafeHtml {
	const { i18n } = view.page;
	const form = (action: string, label: string, dataId: string): SafeHtml =>
		html`<form method="post" action="/claim/tenants/${tenant._id}/${action}" class="inline-form">${csrfField(view.csrf)}${submitButton(label, { variant: "secondary", dataId })}</form>`;
	const bundle = form(
		"enrollment",
		i18n.t("claim.tenants.bundle"),
		`tenant-bundle-${tenant.domain}`,
	);
	if (tenant.status === "enrolling") return bundle;
	if (tenant.status === "migrating") {
		return html`${bundle}${form("migration/cancel", i18n.t("claim.tenants.cancelMigration"), `tenant-cancel-migration-${tenant.domain}`)}`;
	}
	if (tenant.status === "suspended" || isSelfHosted(tenant)) return html``;
	const admin = form(
		"admin",
		i18n.t("claim.tenants.admin"),
		`tenant-admin-${tenant.domain}`,
	);
	if (tenant.status !== "active" || !view.hostings.includes("self")) {
		return admin;
	}
	return html`${admin}<div class="inline-form"><p class="help">${i18n.t("claim.tenants.migrateHelp")}</p>${form("migration", i18n.t("claim.tenants.migrate"), `tenant-migrate-${tenant.domain}`)}</div>`;
}

function ownedTenant(view: ClaimView, tenant: TenantDocument): SafeHtml {
	const { i18n } = view.page;
	const status = STATUS_KEYS[tenant.status];
	return html`<li class="item-row" data-id="tenant-${tenant.domain}"><div>
<p><b>${tenant.domain}</b></p>
${status ? html`<p class="help" data-id="tenant-status-${tenant.domain}">${i18n.t(status)}</p>` : ""}
</div>
${tenantAction(view, tenant)}
</li>`;
}

function claimForm(view: ClaimView): SafeHtml {
	const { i18n } = view.page;
	if (view.hostings.length === 0)
		return html`<p class="help" data-id="claim-closed">${i18n.t("claim.unavailable")}</p>`;
	if (view.identities.length === 0) {
		return html`<p class="help" data-id="claim-no-identity">${i18n.t("claim.noIdentity")}</p>`;
	}
	return html`<form method="post" action="/claim" class="auth-form" data-id="claim-form">${csrfField(view.csrf)}
${inputField({ name: "domain", label: i18n.t("claim.form.domain"), help: i18n.t("claim.form.domainHelp"), autocomplete: "off", maxlength: 253 })}
${hostingChoice(i18n, view.hostings)}
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
<p class="help"><a href="${DOMAIN_GUIDE_PATH}" data-id="claim-guide-link">${i18n.t("claim.guideLink")}</a></p>
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
