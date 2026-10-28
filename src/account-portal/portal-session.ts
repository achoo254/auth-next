import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import type { AccountDocument } from "../accounts/user-model.js";
import { readCookie } from "../http/cookies.js";
import {
	ACCOUNT_PORTAL_CALLBACK_PATH,
	STATIC_CLIENT_IDS,
} from "../oidc/clients.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import type { AppServices } from "../services.js";
import {
	isPortalReturnPath,
	portalStateCookie,
	portalStateCookieOptions,
	rememberPortalReturn,
} from "./portal-cookies.js";

export { consumePortalReturn } from "./portal-cookies.js";

export interface PortalContext {
	readonly account: AccountDocument;
	/** The provider session's uid; CSRF tokens on /account are bound to it. */
	readonly sessionUid: string;
	/** When this session last proved who it is (epoch seconds). */
	readonly loginTs?: number;
}

/** Sensitive changes need a sign-in at most this old. */
export const RECENT_LOGIN_SECONDS = 10 * 60;

/** `state` prefix that tells the callback the user just re-authenticated. */
export const REAUTH_STATE_PREFIX = "reauth.";

export function isRecentLogin(portal: PortalContext): boolean {
	const now = Math.floor(Date.now() / 1000);
	return (
		portal.loginTs !== undefined && now - portal.loginTs <= RECENT_LOGIN_SECONDS
	);
}

/**
 * Reads the IdP's own browser session (oidc-provider's Session, from its
 * signed session cookie). /account has no session store of its own: being
 * signed in to the IdP is what signs you in to the account page.
 */
export async function loadPortalContext(
	services: AppServices,
	req: Request,
	res: Response,
): Promise<PortalContext | undefined> {
	const ctx = services.provider.createContext(req, res);
	const session = await services.provider.Session.get(ctx);
	if (!session.accountId) return undefined;
	const account = await services.accounts.findActiveById(session.accountId);
	return account
		? { account, sessionUid: session.uid, loginTs: session.loginTs }
		: undefined;
}

export function portalCsrfScope(portal: PortalContext): string {
	return `account:${portal.sessionUid}`;
}

/**
 * Sends the browser through a normal authorization request of the portal
 * client, so signing in uses the same login pages (Google/GitHub). The code
 * it returns is never redeemed: only the session cookie set on the way
 * matters, and without the discarded PKCE verifier the code is useless.
 */
export function redirectToPortalLogin(
	services: AppServices,
	res: Response,
	options: {
		readonly reauthenticate?: boolean;
		readonly returnTo?: string;
	} = {},
): void {
	const verifier = randomBytes(32).toString("base64url");
	const nonce = randomBytes(16).toString("base64url");
	const url = new URL(`${services.issuer}${OIDC_ROUTES.authorization}`);
	url.search = new URLSearchParams({
		client_id: STATIC_CLIENT_IDS.accountPortal,
		response_type: "code",
		scope: "openid",
		redirect_uri: `${services.issuer}${ACCOUNT_PORTAL_CALLBACK_PATH}`,
		code_challenge: createHash("sha256").update(verifier).digest("base64url"),
		code_challenge_method: "S256",
		// prompt=login asks to sign in again even with a live session.
		...(options.reauthenticate ? { prompt: "login" } : {}),
		state: options.reauthenticate ? `${REAUTH_STATE_PREFIX}${nonce}` : nonce,
	}).toString();
	res.cookie(portalStateCookie(services), nonce, {
		...portalStateCookieOptions(services),
		maxAge: 30 * 60 * 1000,
	});
	if (options.returnTo) rememberPortalReturn(services, res, options.returnTo);
	res.redirect(303, url.href);
}

/**
 * Reads and clears the portal's state cookie. True only when the callback's
 * `state` is the one this browser was sent off with and asked for a fresh
 * sign-in; a crafted or replayed callback URL gets no "confirmed" notice.
 */
export function consumeReauthState(
	services: AppServices,
	req: Request,
	res: Response,
	state: string,
): boolean {
	const expected = readCookie(req, portalStateCookie(services));
	res.clearCookie(
		portalStateCookie(services),
		portalStateCookieOptions(services),
	);
	if (!expected || !state.startsWith(REAUTH_STATE_PREFIX)) return false;
	const received = Buffer.from(state.slice(REAUTH_STATE_PREFIX.length));
	const wanted = Buffer.from(expected);
	return received.length === wanted.length && timingSafeEqual(received, wanted);
}

export type PortalHandler = (
	req: Request,
	res: Response,
	portal: PortalContext,
) => Promise<void>;

/**
 * Wraps an /account route: without an IdP session the browser goes to the
 * login pages; with `csrf`, the posted token must match this session; with
 * `recentLogin`, a sign-in older than 10 minutes must be repeated first.
 */
export function portalRoute(
	services: AppServices,
	handler: PortalHandler,
	options: {
		readonly csrf: boolean;
		/** Requires a sign-in within RECENT_LOGIN_SECONDS, else asks again. */
		readonly recentLogin?: boolean;
	},
): RequestHandler {
	return (req, res, next) => {
		const run = async (): Promise<void> => {
			const portal = await loadPortalContext(services, req, res);
			const returnTo = `${req.baseUrl}${req.path}`;
			if (!portal) {
				if (req.method === "GET")
					redirectToPortalLogin(services, res, { returnTo });
				else
					res.redirect(
						303,
						isPortalReturnPath(returnTo) ? returnTo : "/account",
					);
				return;
			}
			if (options.csrf && !services.csrf.verify(req, portalCsrfScope(portal))) {
				res.redirect(303, "/account?notice=expired");
				return;
			}
			if (options.recentLogin && !isRecentLogin(portal)) {
				// A confirmation page asks before it shows and comes back to itself,
				// so its button then works. A posted form is not replayed: after
				// signing in again the user lands on /account (with a notice) and
				// repeats the action.
				redirectToPortalLogin(services, res, {
					reauthenticate: true,
					returnTo:
						req.method === "GET" || req.baseUrl !== "/account"
							? returnTo
							: undefined,
				});
				return;
			}
			await handler(req, res, portal);
		};
		run().catch(next);
	};
}
