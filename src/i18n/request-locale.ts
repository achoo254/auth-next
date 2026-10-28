import type { IncomingHttpHeaders } from "node:http";
import { readCookie, readCookies } from "../http/cookies.js";
import {
	DEFAULT_LOCALE,
	type Locale,
	isLocale,
	localeFromAcceptLanguage,
	localeFromUiLocales,
} from "./locales.js";

/**
 * The language picked with the switcher of any app of the brand, remembered
 * for a year: the shared cookie of @achoo254/app-shell, set for the root
 * domain (language-route.ts) and by the apps' own switches.
 */
export const LOCALE_COOKIE = "hd_lang";

/**
 * The shared choice. A browser that still has the host-only cookie of
 * earlier releases sends it as well, before the newer domain cookie
 * (cookies of one path go oldest first), so the last value wins.
 */
function sharedLocaleCookie(req: {
	readonly headers: IncomingHttpHeaders;
}): string | undefined {
	return readCookies(req, LOCALE_COOKIE).filter(isLocale).at(-1);
}

/**
 * The language picked during one sign-in. Its Path is that interaction's
 * `/interaction/<uid>`, so it reaches only those pages and outranks the
 * `ui_locales` the app sent when the sign-in started.
 */
export const INTERACTION_LOCALE_COOKIE = "hd_lang_interaction";

export interface LocaleSources {
	/** Picked with the switcher on this very interaction. */
	readonly pickedForInteraction?: string;
	/** `ui_locales` of the authorization request. */
	readonly uiLocales?: unknown;
	readonly cookie?: string;
	readonly acceptLanguage?: string;
}

/**
 * The page language: a pick made on this sign-in, then the app's
 * `ui_locales`, then the switcher cookie, then Accept-Language, then English.
 */
export function resolveLocale(sources: LocaleSources): Locale {
	if (isLocale(sources.pickedForInteraction)) {
		return sources.pickedForInteraction;
	}
	return (
		localeFromUiLocales(sources.uiLocales) ??
		(isLocale(sources.cookie) ? sources.cookie : undefined) ??
		localeFromAcceptLanguage(sources.acceptLanguage) ??
		DEFAULT_LOCALE
	);
}

/** Works for Express requests and the IncomingMessage under a Koa context. */
export function requestLocale(
	req: { readonly headers: IncomingHttpHeaders },
	uiLocales?: unknown,
): Locale {
	return resolveLocale({
		pickedForInteraction: readCookie(req, INTERACTION_LOCALE_COOKIE),
		uiLocales,
		cookie: sharedLocaleCookie(req),
		acceptLanguage: req.headers["accept-language"],
	});
}
