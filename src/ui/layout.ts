import { stylesheetHref } from "../assets.js";
import { brandHeadTags } from "../brand-install.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { LOCALES, LOCALE_NAMES } from "../i18n/locales.js";
import { appHostsFor } from "../tenants/tenant.js";
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

/**
 * Under every page: the language pill, then the line every app of the
 * brand shares (a link to its home page) and the privacy policy
 * (legal/privacy-page.ts PRIVACY_PATH).
 */
function pageFoot(page: PageContext): SafeHtml {
	const { i18n } = page;
	return html`<footer class="page-foot container">${languageSwitcher(page)}<p class="foot-links"><a class="foot-link" href="https://${i18n.brand.domain}" data-id="foot-home">${i18n.t(
		"layout.ecosystem",
	)}</a><a class="foot-link" href="/privacy" data-id="foot-privacy">${i18n.t(
		"privacy.title",
	)}</a></p></footer>`;
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
const ACCOUNT_LINK: NavLink = {
	href: "/account",
	key: "layout.brand",
	dataId: "nav-account",
};

/** The page's own link is marked current; /account/... counts as Account. */
function topbarNav(page: PageContext): SafeHtml {
	const path = page.path.split("?")[0] ?? "";
	const links = [HOME_LINK, ACCOUNT_LINK];
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

/** The hoandat mark (AI-drawn, static/img), decorative: the wordmark follows it. */
export const BRAND_MARK_PATH = "/assets/img/hoandat-mark-128.webp";

/** Share preview (static/img/og-image.jpg, AI-drawn), 1200 × 630. */
export const OG_IMAGE_PATH = "/assets/img/og-image.jpg";

/** Link previews: title, description and the share image, by absolute URL on the auth host. */
function shareTags(title: string, page: PageContext): SafeHtml {
	const { i18n } = page;
	const image = `https://${appHostsFor(i18n.brand.domain).auth}${OG_IMAGE_PATH}`;
	return html`<meta property="og:type" content="website">
<meta property="og:site_name" content="${i18n.brand.name}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${i18n.t("layout.description")}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${image}">`;
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
${shareTags(`${options.title} · ${i18n.brand.name}`, options.page)}
${brandHeadTags()}
${FONT_STYLESHEETS.map((href) => html`<link rel="stylesheet" href="${href}">`)}
${["tokens.css", "app.css", ...(options.stylesheets ?? [])].map(
	(name) => html`<link rel="stylesheet" href="${stylesheetHref(name)}">`,
)}
</head>
<body>
<header class="topbar"><div class="topbar-inner container">
<a class="idp-brand" href="/apps" data-id="idp-brand"><img class="idp-brand-mark" src="${BRAND_MARK_PATH}" width="24" height="24" alt="" aria-hidden="true"><span><b>${i18n.brand.name}</b><span class="idp-brand-suffix"> · ${i18n.t("layout.brand")}</span></span>${
		options.host
			? html` <span class="badge badge-neutral hide-sm">${options.host}</span>`
			: ""
	}</a>
${topbarNav(options.page)}
</div></header>
${main(options)}
${pageFoot(options.page)}
</body>
</html>`;
	return page.value;
}
