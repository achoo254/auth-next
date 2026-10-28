import type { Request, Response } from "express";
import { readCookie } from "../http/cookies.js";
import type { AppServices } from "../services.js";
import { REVOKE_OTHER_SESSIONS_PATH } from "./account-sections.js";

/** Pages besides /account the sign-in may return to (never a free URL). */
const RETURN_PATHS: ReadonlySet<string> = new Set([
	"/claim",
	REVOKE_OTHER_SESSIONS_PATH,
]);

/** The page that asks before removing one app's access. */
const APP_REVOKE_PATH = /^\/account\/apps\/[A-Za-z0-9._-]{1,128}\/revoke$/;

export function isPortalReturnPath(path: string): boolean {
	return RETURN_PATHS.has(path) || APP_REVOKE_PATH.test(path);
}

/** Remembers an allowed page to come back to after signing in. */
export function rememberPortalReturn(
	services: AppServices,
	res: Response,
	returnTo: string,
): void {
	if (!isPortalReturnPath(returnTo)) return;
	res.cookie(portalReturnCookie(services), returnTo, {
		...portalStateCookieOptions(services),
		maxAge: 30 * 60 * 1000,
	});
}

export function portalStateCookie(services: AppServices): string {
	return services.issuer.startsWith("https:")
		? "__Host-portal_state"
		: "portal_state";
}

function portalReturnCookie(services: AppServices): string {
	return services.issuer.startsWith("https:")
		? "__Host-portal_return"
		: "portal_return";
}

/** Where the callback sends the browser: an allowed page, else /account. */
export function consumePortalReturn(
	services: AppServices,
	req: Request,
	res: Response,
): string | undefined {
	const value = readCookie(req, portalReturnCookie(services));
	if (value === undefined) return undefined;
	res.clearCookie(
		portalReturnCookie(services),
		portalStateCookieOptions(services),
	);
	return isPortalReturnPath(value) ? value : undefined;
}

export function portalStateCookieOptions(services: AppServices): {
	httpOnly: true;
	sameSite: "lax";
	secure: boolean;
	path: string;
} {
	return {
		httpOnly: true,
		sameSite: "lax",
		secure: services.issuer.startsWith("https:"),
		path: "/",
	};
}
