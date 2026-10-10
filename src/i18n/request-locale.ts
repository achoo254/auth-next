import type { IncomingHttpHeaders } from "node:http";
import { readCookie } from "../http/cookies.js";
import {
	DEFAULT_LOCALE,
	type Locale,
	isLocale,
	localeFromAcceptLanguage,
	localeFromUiLocales,
} from "./locales.js";

/** The language picked with the switcher; remembered for a year. */
export const LOCALE_COOKIE = "hd_lang";

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
		cookie: readCookie(req, LOCALE_COOKIE),
		acceptLanguage: req.headers["accept-language"],
	});
}
