import { timingSafeEqual } from "node:crypto";
import { type Request, type Response, Router } from "express";
import { randomToken } from "../accounts/one-time-tokens.js";
import {
	UPSTREAM_LABELS,
	type UpstreamClient,
} from "../accounts/upstream-client.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { readCookie } from "../http/cookies.js";
import { queryValue, routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { asyncHandler, sendInteractionError } from "./interaction-helpers.js";
import { finishAccountLink } from "./upstream-account-link.js";
import { savePendingUpstream } from "./upstream-pending.js";

export type UpstreamPurpose = "login" | "link";

const STATE_TTL_SECONDS = 10 * 60;

function stateCookieName(services: AppServices): string {
	return services.issuer.startsWith("https:")
		? "__Host-upstream_state"
		: "upstream_state";
}

/** Set and cleared with the same attributes, or browsers keep the cookie. */
function stateCookieOptions(services: AppServices): {
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

/**
 * Redirects to Google/GitHub. The state is random, bound to this browser
 * by an HttpOnly cookie and stored hashed with the PKCE verifier, the nonce
 * and the purpose, for ten minutes and one use.
 */
export async function startUpstream(
	services: AppServices,
	res: Response,
	client: UpstreamClient,
	purpose: UpstreamPurpose,
	binding: { readonly uid?: string; readonly accountId?: string },
): Promise<void> {
	const checks = {
		state: randomToken(),
		codeVerifier: randomToken(),
		nonce: randomToken(),
	};
	const url = await client.authorizationUrl(checks);
	const data = {
		provider: client.provider,
		purpose,
		verifier: checks.codeVerifier,
		nonce: checks.nonce,
		...(binding.uid ? { uid: binding.uid } : {}),
	};
	if (binding.accountId) {
		// Linking acts on an account: bound to its security version.
		await services.accountTokens.issue(
			"upstream-link-state",
			checks.state,
			binding.accountId,
			data,
			STATE_TTL_SECONDS,
		);
	} else {
		await services.tokens.put(
			"upstream-state",
			checks.state,
			data,
			STATE_TTL_SECONDS,
		);
	}
	res.cookie(stateCookieName(services), checks.state, {
		...stateCookieOptions(services),
		maxAge: STATE_TTL_SECONDS * 1000,
	});
	res.redirect(303, url.href);
}

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

/** /oauth/:provider/callback, the redirect URI registered with each provider. */
export function createUpstreamCallbackRouter(services: AppServices): Router {
	const router = Router();
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
			if (
				!data ||
				data.provider !== client.provider ||
				!data.verifier ||
				!data.nonce
			) {
				sendInteractionError(services, res, expired);
				return;
			}
			const back = data.uid ? `/interaction/${data.uid}` : "/account";
			if (!queryValue(req, "code")) {
				// The user cancelled at the provider (error=access_denied).
				res.redirect(303, back);
				return;
			}
			let profile: Awaited<ReturnType<UpstreamClient["fetchProfile"]>>;
			try {
				const query = new URL(req.originalUrl, services.issuer).searchParams;
				profile = await client.fetchProfile(query, {
					state,
					codeVerifier: data.verifier,
					nonce: data.nonce,
				});
			} catch (error) {
				services.logger.warn(
					{ err: error, provider: client.provider },
					"Upstream sign-in failed",
				);
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
