import { Router } from "express";
import { formRateLimit, queryValue } from "../http/form.js";
import { normalizeRoutePath } from "../http/route-path.js";
import { INTERACTION_PATH, TTL_SECONDS } from "../oidc/provider.js";
import type { AppServices } from "../services.js";
import { LANGUAGE_PATH } from "../ui/layout.js";
import { isLocale } from "./locales.js";
import { INTERACTION_LOCALE_COOKIE, LOCALE_COOKIE } from "./request-locale.js";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_RETURN = "/account";
const MAX_RETURN_LENGTH = 2048;
/** Control characters and backslashes (browsers read `\` as `/`). */
function hasUnsafeCharacter(value: string): boolean {
	for (const char of value) {
		const code = char.charCodeAt(0);
		if (code < 0x20 || code === 0x7f || char === "\\") return true;
	}
	return false;
}

/**
 * The page to go back to: only a same-origin path ("/account?x=1"), never
 * "//host", "/\host", a scheme, control characters or the switcher itself.
 * Returns path and query of the parsed URL, or undefined.
 */
export function safeReturnPath(
	raw: string | undefined,
	issuer: string,
): string | undefined {
	if (!raw || raw.length > MAX_RETURN_LENGTH) return undefined;
	if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
	if (hasUnsafeCharacter(raw)) return undefined;
	const base = new URL(issuer);
	const url = URL.parse(raw, base);
	if (!url || url.origin !== base.origin) return undefined;
	// Express routes ignore case and a trailing slash: /LANG/ is the switcher.
	if (normalizeRoutePath(url.pathname) === LANGUAGE_PATH) return undefined;
	return `${url.pathname}${url.search}`;
}

const INTERACTION_RETURN = new RegExp(
	`^${INTERACTION_PATH}/([\\w-]{1,100})(?:[/?]|$)`,
);

/** `/interaction/<uid>` when the return path is a page of one sign-in. */
function interactionPathOf(path: string): string | undefined {
	const uid = INTERACTION_RETURN.exec(path)?.[1];
	return uid ? `${INTERACTION_PATH}/${uid}` : undefined;
}

/**
 * GET /lang?set=<locale>&return=<path>: the language switcher of every
 * page. Remembers the choice in a cookie and goes back with a 303. On a
 * sign-in page the choice also outranks the app's `ui_locales` for the
 * rest of that sign-in, through a cookie scoped to its interaction path.
 */
export function createLanguageRouter(services: AppServices): Router {
	const router = Router();
	const secure = services.issuer.startsWith("https:");
	router.get(
		LANGUAGE_PATH,
		formRateLimit(services.formPostsPerMinute),
		(req, res) => {
			const locale = queryValue(req, "set");
			const target =
				safeReturnPath(queryValue(req, "return"), services.issuer) ??
				DEFAULT_RETURN;
			if (isLocale(locale)) {
				const options = { httpOnly: true, sameSite: "lax", secure } as const;
				res.cookie(LOCALE_COOKIE, locale, {
					...options,
					path: "/",
					maxAge: YEAR_MS,
				});
				const interactionPath = interactionPathOf(target);
				if (interactionPath) {
					res.cookie(INTERACTION_LOCALE_COOKIE, locale, {
						...options,
						path: interactionPath,
						maxAge: TTL_SECONDS.Interaction * 1000,
					});
				}
			}
			res.set("cache-control", "no-store").redirect(303, target);
		},
	);
	return router;
}
