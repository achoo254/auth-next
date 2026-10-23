import type { Response, Router } from "express";
import { randomToken } from "../accounts/one-time-tokens.js";
import type { UpstreamClient } from "../accounts/upstream-client.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { queryValue, routeParam } from "../http/form.js";
import { IOS_LINKED_PATH } from "../oidc/account-ios-client.js";
import type { AppServices } from "../services.js";
import { asyncHandler } from "./interaction-helpers.js";
import { stateCookieName, stateCookieOptions } from "./upstream-start.js";

/**
 * Linking a provider from the iOS account app (ADR 0009, "Liên kết từ
 * app"). The app has no IdP browser session, so instead of the portal's
 * cookie the link state itself carries the account, its security version
 * and the app grant that asked, issued only after a re-authenticated API
 * call. The browser sheet opens it once at /oauth/<provider>/start, which
 * binds it to that browser (state cookie) as any sign-in. The callback
 * never links (the sheet's URL could be someone else's): it holds the
 * provider's answer for the app to confirm (app-link-result.ts), without
 * reading or creating any IdP session.
 */
export const APP_LINK_PURPOSE = "link-app";

const APP_LINK_TTL_SECONDS = 5 * 60;

/** Outcomes the app reads from /ios/linked?result=… (`pending`: confirm). */
export type AppLinkResult = "pending" | "cancelled" | "expired" | "failed";

/** Ends the browser sheet on the app's universal link. */
export function redirectToApp(
	services: AppServices,
	res: Response,
	result: AppLinkResult,
	provider?: string,
): void {
	const url = new URL(IOS_LINKED_PATH, services.issuer);
	url.searchParams.set("result", result);
	if (provider) url.searchParams.set("provider", provider);
	res.redirect(303, url.href);
}

/**
 * Issues the one-time link state (5 minutes) for `accountId`, bound to the
 * app grant `grantId`; returns the URL the app opens, or undefined when the
 * account is gone.
 */
export async function issueAppLink(
	services: AppServices,
	client: UpstreamClient,
	accountId: string,
	grantId: string,
): Promise<URL | undefined> {
	const state = randomToken();
	const issued = await services.accountTokens.issue(
		"upstream-link-state",
		state,
		accountId,
		{
			provider: client.provider,
			purpose: APP_LINK_PURPOSE,
			verifier: randomToken(),
			nonce: randomToken(),
			grantId,
		},
		APP_LINK_TTL_SECONDS,
	);
	if (!issued) return undefined;
	const url = new URL(`/oauth/${client.provider}/start`, services.issuer);
	url.searchParams.set("state", state);
	return url;
}

/**
 * GET /oauth/:provider/start?state=…: opens an app link state once (a
 * second open, or one after a security change, ends as `expired`), sets
 * the state cookie and goes to the provider.
 */
export function registerAppLinkStart(
	router: Router,
	services: AppServices,
): void {
	router.get(
		"/:provider/start",
		asyncHandler(async (req, res) => {
			const name = routeParam(req, "provider");
			const client = isUpstreamProvider(name)
				? services.upstreams.get(name)
				: undefined;
			const state = queryValue(req, "state") ?? "";
			if (!client || !state) {
				res.sendStatus(404);
				return;
			}
			const found = await services.accountTokens.peek(
				"upstream-link-state",
				state,
			);
			const { verifier, nonce } = found.status === "ok" ? found.data : {};
			const opens =
				found.status === "ok" &&
				found.data.purpose === APP_LINK_PURPOSE &&
				found.data.provider === client.provider &&
				verifier !== undefined &&
				nonce !== undefined &&
				(await services.tokens.claim(
					"link-app-started",
					state,
					{ accountId: found.account._id },
					APP_LINK_TTL_SECONDS,
				));
			if (!opens || !verifier || !nonce) {
				redirectToApp(services, res, "expired", client.provider);
				return;
			}
			const url = await client.authorizationUrl({
				state,
				codeVerifier: verifier,
				nonce,
				freshLogin: false,
			});
			res.cookie(stateCookieName(services), state, {
				...stateCookieOptions(services),
				maxAge: APP_LINK_TTL_SECONDS * 1000,
			});
			res.redirect(303, url.href);
		}),
	);
}
