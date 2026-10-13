import type { RequestHandler } from "express";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { appHostsFor } from "./tenant.js";
import type { Tenant } from "./tenant.js";

/** /admin without an owner session: where to open it from. */
export function renderAdminSignedOut(
	page: PageContext,
	claimUrl: string,
	domain: string,
): string {
	const { i18n } = page;
	return renderPage({
		title: i18n.t("admin.title"),
		host: appHostsFor(domain).auth,
		page,
		body: html`${pageTitle(i18n.t("admin.title"), i18n.rich("admin.signedOut", { link: html`<a class="link" href="${claimUrl}" data-id="admin-claim-link">${claimUrl}</a>` }))}`,
	});
}

/** Answers every request of a tenant that is not active yet (404 page). */
export function inactiveTenant(tenant: Pick<Tenant, "issuer">): RequestHandler {
	const host = new URL(tenant.issuer).host;
	return (req, res) => {
		sendPage(res, renderInactive(pageContext(req), host), 404);
	};
}

/** Every other page of a tenant that is not active yet. */
export function renderInactive(page: PageContext, host: string): string {
	const { i18n } = page;
	return renderPage({
		title: i18n.t("inactive.title"),
		host,
		page,
		body: html`${pageTitle(i18n.t("inactive.title"), i18n.t("inactive.body", { host }))}`,
	});
}
