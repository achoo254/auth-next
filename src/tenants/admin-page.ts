import type { TenantOAuthProvider } from "../accounts/user-model.js";
import { TENANT_OAUTH_PROVIDERS } from "../accounts/user-model.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { reopenAfterError } from "./admin-blocks.js";
import { dnsCard, domainCard, telegramCard } from "./admin-cards.js";
import { oauthCard } from "./admin-oauth-card.js";
import {
	type ScribeAdminView,
	scribeAdminCard,
} from "./admin-scribe-section.js";
import type { TenantDocument } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

export interface AdminView {
	readonly page: PageContext;
	readonly csrf: string;
	readonly tenant: TenantDocument;
	/** The step-by-step guide, on the primary tenant (absolute URL). */
	readonly guideUrl: string;
	/** Client ids of the configured OAuth apps (never their secrets). */
	readonly oauth: Readonly<Partial<Record<TenantOAuthProvider, string>>>;
	readonly dnsConfigured: boolean;
	readonly dnsAvailable: boolean;
	readonly telegramUsername?: string;
	/** Present when Scribe on tenants is enabled (ADR 0012). */
	readonly scribe?: ScribeAdminView;
	readonly result?: {
		readonly tone: "success" | "error";
		readonly text: string;
	};
}

/** A headed group of cards, two per row on wide screens. */
function adminGroup(
	id: string,
	title: string,
	cards: readonly SafeHtml[],
): SafeHtml {
	return html`<section class="account-group" aria-labelledby="group-admin-${id}" data-id="group-admin-${id}">
<h2 class="account-group-title" id="group-admin-${id}">${title}</h2>
<div class="account-grid admin-grid">${cards}</div>
</section>`;
}

/** Title and lead, with the guide and "Leave admin" beside them. */
function header(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	return html`<div class="admin-head">
<div class="admin-head-text">${pageTitle(i18n.t("admin.title"), i18n.t("admin.lead", { domain: view.tenant.domain }))}</div>
<div class="admin-head-actions"><a class="link" href="${view.guideUrl}" data-id="admin-guide-link">${i18n.t("claim.guideLink")}</a>
<form method="post" action="/admin/sign-out" class="inline-form">${csrfField(view.csrf)}${submitButton(i18n.t("admin.signOut"), { variant: "secondary", dataId: "admin-sign-out" })}</form></div>
</div>`;
}

/**
 * A tenant's /admin, for its owner only (the route checks the session):
 * the domain (addresses, certificates, name), how people sign in, the
 * Cloudflare and Telegram integrations, then the apps the owner turns on.
 */
export function renderAdminPage(view: AdminView): string {
	const { i18n } = view.page;
	const { domain } = view.tenant;
	const body = html`${header(view)}
${view.result ? alertBox(view.result.tone, view.result.text) : ""}
${adminGroup("domain", i18n.t("admin.group.domain"), [domainCard(view)])}
${adminGroup(
	"sign-in",
	i18n.t("admin.group.signIn"),
	TENANT_OAUTH_PROVIDERS.map((provider) => oauthCard(view, provider)),
)}
${adminGroup("integrations", i18n.t("admin.group.integrations"), [dnsCard(view), telegramCard(view)])}
${
	view.scribe
		? adminGroup("apps", i18n.t("admin.group.apps"), [
				scribeAdminCard(
					view.page,
					view.csrf,
					view.tenant,
					view.scribe,
					reopenAfterError(view),
				),
			])
		: ""
}`;
	return renderPage({
		title: i18n.t("admin.title"),
		host: appHostsFor(domain).auth,
		page: view.page,
		layout: "portal",
		nav: false,
		stylesheets: ["admin.css"],
		body,
	});
}
