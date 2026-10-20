import { stylesheetHref } from "../assets.js";
import { DOMAIN_GUIDE_PATH } from "../guide/domain-guide-link.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { LOCALES, LOCALE_NAMES } from "../i18n/locales.js";
import { type HtmlValue, type SafeHtml, html } from "./html.js";
import type { PageContext } from "./page-context.js";

export interface PageOptions {
	readonly title: string;
	readonly body: HtmlValue;
	readonly page: PageContext;
	/** Host shown next to the wordmark (the issuer's host). */
	readonly host?: string;
	/**
	 * `card` (default) is the narrow sign-in card; `wide` a wider card for
	 * reading; `portal` drops the outer card for pages made of cards.
	 */
	readonly layout?: "card" | "wide" | "portal";
	/** Extra stylesheets of static/css by file name, after app.css (one page's own styles). */
	readonly stylesheets?: readonly string[];
	/**
	 * Home and Account links in the topbar, plus the domain guide where it is
	 * served (default true). Off on /admin,
	 * which a tenant serves before it has a home page or accounts.
	 */
	readonly nav?: boolean;
}

const FONT_STYLESHEETS = [
	"/assets/fonts/inter/400.css",
	"/assets/fonts/inter/500.css",
	"/assets/fonts/inter/600.css",
	"/assets/fonts/jetbrains-mono/400.css",
	"/assets/fonts/jetbrains-mono/600.css",
	"/assets/fonts/jetbrains-mono/700.css",
];

/** Path of the language switcher endpoint (see i18n/language-route.ts). */
export const LANGUAGE_PATH = "/lang";

export function languageHref(locale: string, returnTo: string): string {
	const query = new URLSearchParams({ set: locale, return: returnTo });
	return `${LANGUAGE_PATH}?${query.toString()}`;
}

/** Plain links, no script: each one sets the cookie and comes back here. */
function languageSwitcher(page: PageContext): SafeHtml {
	const current = page.i18n.locale;
	return html`<nav class="lang-switch" aria-label="${page.i18n.t("layout.language")}" data-id="lang-switch">${LOCALES.map(
		(locale) =>
			html`<a class="lang-option" href="${languageHref(locale, page.path)}" lang="${locale}" hreflang="${locale}"${
				locale === current ? html` aria-current="true"` : ""
			} data-id="lang-${locale}">${LOCALE_NAMES[locale]}</a>`,
	)}</nav>`;
}

interface NavLink {
	readonly href: string;
	readonly key: MessageKey;
	readonly dataId: string;
}

const HOME_LINK: NavLink = {
	href: "/apps",
	key: "layout.home",
	dataId: "nav-home",
};
const GUIDE_LINK: NavLink = {
	href: DOMAIN_GUIDE_PATH,
	key: "layout.guide",
	dataId: "nav-guide",
};
const ACCOUNT_LINK: NavLink = {
	href: "/account",
	key: "layout.brand",
	dataId: "nav-account",
};

/** The page's own link is marked current; /account/... counts as Account. */
function topbarNav(page: PageContext): SafeHtml {
	const path = page.path.split("?")[0] ?? "";
	const links = page.domainGuide
		? [HOME_LINK, GUIDE_LINK, ACCOUNT_LINK]
		: [HOME_LINK, ACCOUNT_LINK];
	return html`<nav class="topbar-nav" aria-label="${page.i18n.t("layout.nav")}">${links.map(
		(link) =>
			html`<a class="topbar-link" href="${link.href}"${
				path === link.href || path.startsWith(`${link.href}/`)
					? html` aria-current="page"`
					: ""
			} data-id="${link.dataId}">${page.i18n.t(link.key)}</a>`,
	)}</nav>`;
}

function main(options: PageOptions): SafeHtml {
	if (options.layout === "portal") {
		return html`<main class="page container portal">${options.body}</main>`;
	}
	return html`<main class="page container auth">
<div class="card auth-card${options.layout === "wide" ? " auth-card-wide" : ""}">
${options.body}
</div>
</main>`;
}

/**
 * Shared shell of every IdP page: self-hosted fonts and token CSS, the
 * "<brand> · Account" wordmark (the tenant's brand) with the Home and
 * Account links, the language switcher, no script at all.
 */
export function renderPage(options: PageOptions): string {
	const { i18n } = options.page;
	const page: SafeHtml = html`<!DOCTYPE html>
<html lang="${i18n.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta name="description" content="${i18n.t("layout.description")}">
<title>${options.title} · ${i18n.brand.name}</title>
${FONT_STYLESHEETS.map((href) => html`<link rel="stylesheet" href="${href}">`)}
${["tokens.css", "app.css", ...(options.stylesheets ?? [])].map(
	(name) => html`<link rel="stylesheet" href="${stylesheetHref(name)}">`,
)}
</head>
<body>
<header class="topbar"><div class="topbar-inner container">
<a class="idp-brand" href="${options.nav === false ? "/account" : "/apps"}" data-id="idp-brand"><span><b>${i18n.brand.name}</b><span class="idp-brand-suffix"> · ${i18n.t("layout.brand")}</span></span>${
		options.host
			? html` <span class="badge badge-neutral hide-sm">${options.host}</span>`
			: ""
	}</a>
${options.nav === false ? "" : topbarNav(options.page)}
</div></header>
${main(options)}
<footer class="page-foot container">${languageSwitcher(options.page)}</footer>
</body>
</html>`;
	return page.value;
}
