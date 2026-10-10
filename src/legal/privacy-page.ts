import { Router } from "express";
import type { MessageKey } from "../i18n/dictionaries.js";
import { pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";

export const PRIVACY_PATH = "/privacy";

const STORED: readonly MessageKey[] = [
	"privacy.stored.profile",
	"privacy.stored.noPassword",
	"privacy.stored.providers",
	"privacy.stored.telegram",
	"privacy.stored.sessions",
	"privacy.stored.securityLog",
];

/**
 * Public privacy policy. Google requires one before a "Sign in with Google"
 * app can leave testing; it states only what this service actually stores.
 */
export function renderPrivacyPage(host: string, page: PageContext): string {
	const { i18n } = page;
	const title = i18n.t("privacy.title");
	return renderPage({
		title,
		host,
		page,
		layout: "wide",
		body: html`${pageTitle(title, i18n.t("privacy.subtitle"))}
<div class="prose" data-id="privacy-policy">
<h2>${i18n.t("privacy.stored.title")}</h2>
<ul>${STORED.map((key) => html`<li>${i18n.t(key)}</li>`)}</ul>
<h2>${i18n.t("privacy.purpose.title")}</h2>
<p>${i18n.t("privacy.purpose.body")}</p>
<h2>${i18n.t("privacy.sharing.title")}</h2>
<p>${i18n.t("privacy.sharing.body")}</p>
<h2>${i18n.t("privacy.rights.title")}</h2>
<p>${i18n.rich("privacy.rights.body", { account: html`<a href="/account">${i18n.t("layout.brand")}</a>`, email: "quocdat254@gmail.com" })}</p>
<h2>${i18n.t("privacy.storage.title")}</h2>
<p>${i18n.t("privacy.storage.body")}</p>
</div>`,
	});
}

/**
 * The page depends on the visitor's language (cookie, Accept-Language),
 * so caches must revalidate rather than serve one language to everyone.
 */
export function createPrivacyRouter(host: string): Router {
	const router = Router();
	router.get(PRIVACY_PATH, (req, res) => {
		res
			.status(200)
			.set("cache-control", "private, no-cache")
			.vary("Cookie")
			.vary("Accept-Language")
			.type("html")
			.send(renderPrivacyPage(host, pageContext(req)));
	});
	return router;
}
