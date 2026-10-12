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
	/** Extra stylesheets under /assets/css, after app.css (one page's own styles). */
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
 * "hoandat · Account" wordmark, the language switcher, no script at all.
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
<title>${options.title} · hoandat</title>
${FONT_STYLESHEETS.map((href) => html`<link rel="stylesheet" href="${href}">`)}
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/app.css">
${(options.stylesheets ?? []).map((href) => html`<link rel="stylesheet" href="${href}">`)}
</head>
<body>
<header class="topbar"><div class="topbar-inner container">
<a class="idp-brand" href="/account" data-id="idp-brand"><b>hoandat</b> · ${i18n.t("layout.brand")}${
		options.host
			? html` <span class="badge badge-neutral hide-sm">${options.host}</span>`
			: ""
	}</a>
</div></header>
${main(options)}
<footer class="page-foot container">${languageSwitcher(options.page)}</footer>
</body>
</html>`;
	return page.value;
}
