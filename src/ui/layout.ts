import { PublicPage } from "@achoo254/app-shell";
import { type ReactElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { appShellHref, stylesheetHref } from "../assets.js";
import { brandHeadTags } from "../brand-install.js";
import { LOCALES, type Locale } from "../i18n/locales.js";
import { appHostsFor } from "../tenants/tenant.js";
import { type HtmlValue, type SafeHtml, html, trustedHtml } from "./html.js";
import type { PageContext } from "./page-context.js";

export interface PageOptions {
	readonly title: string;
	readonly body: HtmlValue;
	readonly page: PageContext;
	/**
	 * `card` (default) is the narrow sign-in card; `wide` a wider card for
	 * reading; `portal` drops the outer card for pages made of cards.
	 */
	readonly layout?: "card" | "wide" | "portal";
	/** Extra stylesheets of static/css by file name, after app.css (one page's own styles). */
	readonly stylesheets?: readonly string[];
	/**
	 * The signed-in account's menu (the shell's AccountMenu), in place of
	 * the Account link; only pages that know the session pass it.
	 */
	readonly accountMenu?: ReactElement;
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

const HOME_PATH = "/apps";
const ACCOUNT_PATH = "/account";
/** legal/privacy-page.ts PRIVACY_PATH (that module imports this one). */
const PRIVACY_PATH = "/privacy";

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

/** The page's own link is marked current; /account/... counts as Account. */
function isCurrent(page: PageContext, href: string): boolean {
	const path = page.path.split("?")[0] ?? "";
	return path === href || path.startsWith(`${href}/`);
}

/** The page body in its frame: the sign-in card, the wide card, or the portal grid. */
function framedBody(options: PageOptions): ReactElement {
	const layout = options.layout ?? "card";
	const className =
		layout === "portal"
			? "portal"
			: `card auth-card${layout === "wide" ? " auth-card-wide" : ""}`;
	return createElement("div", {
		className,
		// The body is SafeHtml, built by the escaping `html` template.
		dangerouslySetInnerHTML: { __html: html`${options.body}`.value },
	});
}

/**
 * Header, frame and footer of the shared app shell (@achoo254/app-shell),
 * rendered on the server without client React: the Home link, the account
 * menu (or the Account link) in the account slot, language links (each
 * sets the cookie on the server and comes back here) and the theme switch
 * and account menu run by app-shell-enhance.js.
 */
function shellPage(options: PageOptions): string {
	const { page } = options;
	const { i18n } = page;
	return renderToStaticMarkup(
		createElement(PublicPage<Locale>, {
			brand: {
				appName: i18n.brand.name,
				domain: i18n.brand.domain,
				markSrc: BRAND_MARK_PATH,
			},
			locale: i18n.locale,
			locales: LOCALES,
			languageHref: (locale) => languageHref(locale, page.path),
			homeHref: HOME_PATH,
			signInHref: ACCOUNT_PATH,
			navLinks: [
				{
					href: HOME_PATH,
					label: i18n.t("layout.home"),
					dataId: "nav-home",
					current: isCurrent(page, HOME_PATH),
				},
			],
			accountSlot:
				options.accountMenu ??
				createElement(
					"a",
					{
						className: "shell-topbar-link",
						href: ACCOUNT_PATH,
						"data-id": "nav-account",
						"aria-current": isCurrent(page, ACCOUNT_PATH) ? "page" : undefined,
					},
					i18n.t("layout.brand"),
				),
			privacyHref: PRIVACY_PATH,
			termsHref: null,
			layout: options.layout === "portal" ? "flow" : "center",
			// biome-ignore lint/correctness/noChildrenProp: PublicPageProps requires children among the props
			children: framedBody(options),
		}),
	);
}

/**
 * Every IdP page: self-hosted fonts, the shell's tokens and stylesheet, the
 * theme script (an external file that sets the stored theme before the
 * first paint; the CSP allows no inline script), then the page in the
 * shared header, frame and footer.
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
<script src="${appShellHref("app-shell-enhance.js")}"></script>
${FONT_STYLESHEETS.map((href) => html`<link rel="stylesheet" href="${href}">`)}
<link rel="stylesheet" href="${appShellHref("tokens.css")}">
<link rel="stylesheet" href="${appShellHref("app-shell.css")}">
${["app.css", ...(options.stylesheets ?? [])].map(
	(name) => html`<link rel="stylesheet" href="${stylesheetHref(name)}">`,
)}
</head>
<body>
${trustedHtml(shellPage(options))}
</body>
</html>`;
	return page.value;
}
