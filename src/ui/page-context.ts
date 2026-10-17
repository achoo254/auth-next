import type { Request } from "express";
import type { KoaContextWithOIDC } from "oidc-provider";
import { offersDomainGuide } from "../guide/domain-guide-link.js";
import { requestLocale } from "../i18n/request-locale.js";
import { type Translator, brandOf, translator } from "../i18n/translator.js";
import { requestTenant } from "../tenants/request-tenant.js";

/**
 * What every page needs about the request: its language (and the brand of
 * the tenant serving it) and its path.
 */
export interface PageContext {
	readonly i18n: Translator;
	/**
	 * Same-origin path the language switcher returns to: the page itself
	 * for a GET, otherwise a page that can be opened again with a GET.
	 */
	readonly path: string;
	/** The topbar links the domain guide (only where it is served). */
	readonly domainGuide: boolean;
}

/** Longer return paths fall back to the bare path (no query string). */
const MAX_RETURN_LENGTH = 1024;

function returnPath(url: string, fallback: string): string {
	if (url.length <= MAX_RETURN_LENGTH) return url;
	const bare = url.split("?")[0] ?? "";
	return bare.length <= MAX_RETURN_LENGTH ? bare : fallback;
}

/**
 * Page context of an Express request. Interaction pages pass the
 * authorization request's `ui_locales`; pages rendered for a POST name the
 * page to return to (`fallbackPath`, default /account).
 */
export function pageContext(
	req: Request,
	options: {
		readonly uiLocales?: unknown;
		readonly fallbackPath?: string;
	} = {},
): PageContext {
	const fallback = options.fallbackPath ?? "/account";
	const isGet = req.method === "GET" || req.method === "HEAD";
	return {
		i18n: translator(
			requestLocale(req, options.uiLocales),
			brandOf(requestTenant(req)),
		),
		path: isGet ? returnPath(req.originalUrl, fallback) : fallback,
		domainGuide: offersDomainGuide(req),
	};
}

/**
 * Page context inside an oidc-provider hook. `path` replaces the request
 * URL when that URL carries something that must not travel further (the
 * logout page's id_token_hint).
 */
export function koaPageContext(
	ctx: KoaContextWithOIDC,
	options: { readonly path?: string; readonly uiLocales?: unknown } = {},
): PageContext {
	const fallback = options.path ?? ctx.path;
	const isGet = ctx.method === "GET" && options.path === undefined;
	return {
		i18n: translator(
			requestLocale(ctx.req, options.uiLocales),
			brandOf(requestTenant(ctx.req)),
		),
		path: isGet ? returnPath(ctx.originalUrl, fallback) : fallback,
		domainGuide: offersDomainGuide(ctx.req),
	};
}
