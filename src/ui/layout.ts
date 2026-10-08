import { type HtmlValue, type SafeHtml, html } from "./html.js";

export interface PageOptions {
	readonly title: string;
	readonly body: HtmlValue;
	/** Host shown next to the wordmark (the issuer's host). */
	readonly host?: string;
	/** Wider card for the account portal. */
	readonly wide?: boolean;
}

const FONT_STYLESHEETS = [
	"/assets/fonts/inter/400.css",
	"/assets/fonts/inter/500.css",
	"/assets/fonts/inter/600.css",
	"/assets/fonts/jetbrains-mono/400.css",
	"/assets/fonts/jetbrains-mono/600.css",
	"/assets/fonts/jetbrains-mono/700.css",
];

/**
 * Shared shell of every IdP page: self-hosted fonts and token CSS, the
 * "hoandat · Tài khoản" wordmark, no script at all.
 */
export function renderPage(options: PageOptions): string {
	const page: SafeHtml = html`<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${options.title} · hoandat</title>
${FONT_STYLESHEETS.map((href) => html`<link rel="stylesheet" href="${href}">`)}
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/app.css">
</head>
<body>
<header class="topbar"><div class="topbar-inner container">
<a class="idp-brand" href="/account" data-id="idp-brand"><b>hoandat</b> · Tài khoản${
		options.host
			? html` <span class="badge badge-neutral hide-sm">${options.host}</span>`
			: ""
	}</a>
</div></header>
<main class="page container auth">
<div class="card auth-card${options.wide ? " auth-card-wide" : ""}">
${options.body}
</div>
</main>
</body>
</html>`;
	return page.value;
}
