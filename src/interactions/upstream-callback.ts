import { timingSafeEqual } from "node:crypto";
import { type Request, type Response, Router } from "express";
import {
	UPSTREAM_LABELS,
	type UpstreamClient,
} from "../accounts/upstream-client.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { readCookie } from "../http/cookies.js";
import { queryValue, routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { registerAppleNotifications } from "./apple-notifications.js";
import { asyncHandler, sendInteractionError } from "./interaction-helpers.js";
import { finishAccountLink } from "./upstream-account-link.js";
import {
	APP_LINK_PURPOSE,
	finishAppLink,
	redirectToApp,
	registerAppLinkStart,
} from "./upstream-app-link.js";
import {
	registerFormPostCallback,
	takeFormPost,
} from "./upstream-form-post.js";
import { savePendingUpstream } from "./upstream-pending.js";
import { stateCookieName, stateCookieOptions } from "./upstream-start.js";

/**
 * Uses up an OAuth state: a sign-in state, or a link state bound to
 * an account. A link state from before a security change of that account
 * reads as missing (the flow is simply restarted).
 */
async function takeState(
	services: AppServices,
	state: string,
): Promise<Record<string, string> | undefined> {
	const free = await services.tokens.take("upstream-state", state);
	if (free) return free;
	const bound = await services.accountTokens.take("upstream-link-state", state);
	return bound.status === "ok"
		? {
				...bound.data,
				accountId: bound.account._id,
				securityVersion: String(bound.version),
			}
		: undefined;
}

function sameState(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

/** The provider's answer: this request's query, or the form it posted. */
async function callbackParams(
	services: AppServices,
	client: UpstreamClient,
	req: Request,
	state: string,
): Promise<URLSearchParams | undefined> {
	return client.responseMode === "form_post"
		? takeFormPost(services, state)
		: new URL(req.originalUrl, services.issuer).searchParams;
}

/**
 * /oauth/:provider/callback, the redirect URI registered with each
 * provider. The state must match the browser's state cookie: that binds
 * the answer to the browser that started the sign-in (no login CSRF).
 */
export function createUpstreamCallbackRouter(services: AppServices): Router {
	const router = Router();
	registerFormPostCallback(router, services);
	registerAppleNotifications(router, services);
	registerAppLinkStart(router, services);
	router.get(
		"/:provider/callback",
		asyncHandler(async (req: Request, res: Response) => {
			const name = routeParam(req, "provider");
			const client = isUpstreamProvider(name)
				? services.upstreams.get(name)
				: undefined;
			if (!client) {
				res.sendStatus(404);
				return;
			}
			const label = UPSTREAM_LABELS[client.provider];
			const expired = {
				message: "upstream.expired",
				params: { provider: label },
				status: 410,
			} as const;
			const state = queryValue(req, "state") ?? "";
			const cookie = readCookie(req, stateCookieName(services)) ?? "";
			res.clearCookie(stateCookieName(services), stateCookieOptions(services));
			const data =
				state && cookie && sameState(state, cookie)
					? await takeState(services, state)
					: undefined;
			const params = data
				? await callbackParams(services, client, req, state)
				: undefined;
			if (
				!data ||
				!params ||
				data.provider !== client.provider ||
				!data.verifier ||
				!data.nonce
			) {
				sendInteractionError(services, res, expired);
				return;
			}
			const back = data.uid ? `/interaction/${data.uid}` : "/account";
			// Linking from the iOS app ends on the app's universal link.
			const fromApp = data.purpose === APP_LINK_PURPOSE;
			if (!params.get("code")) {
				// The user cancelled at the provider (error=access_denied,
				// Apple: user_cancelled_authorize).
				if (fromApp) redirectToApp(services, res, "cancelled", client.provider);
				else res.redirect(303, back);
				return;
			}
			let profile: Awaited<ReturnType<UpstreamClient["fetchProfile"]>>;
			try {
				profile = await client.fetchProfile(params, {
					state,
					codeVerifier: data.verifier,
					nonce: data.nonce,
					freshLogin: data.freshLogin === "1",
				});
			} catch (error) {
				services.logger.warn(
					{ err: error, provider: client.provider },
					"Upstream sign-in failed",
				);
				if (fromApp) {
					redirectToApp(services, res, "failed", client.provider);
					return;
				}
				sendInteractionError(services, res, {
					message: "upstream.failed",
					params: { provider: label },
					status: 502,
					back: { href: back, label: "common.back" },
				});
				return;
			}
			if (data.purpose === "login" && data.uid) {
				await savePendingUpstream(services, data.uid, profile);
				res.redirect(303, `/interaction/${data.uid}/upstream`);
				return;
			}
			if (fromApp && data.accountId && data.grantId) {
				await finishAppLink(services, res, {
					accountId: data.accountId,
					grantId: data.grantId,
					version: Number(data.securityVersion ?? "0"),
					profile,
				});
				return;
			}
			if (data.purpose !== "link" || !data.accountId) {
				sendInteractionError(services, res, expired);
				return;
			}
			await finishAccountLink(services, req, res, {
				accountId: data.accountId,
				version: Number(data.securityVersion ?? "0"),
				profile,
			});
		}),
	);
	return router;
}
