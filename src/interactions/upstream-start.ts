import type { Response } from "express";
import { randomToken } from "../accounts/one-time-tokens.js";
import type { UpstreamClient } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";
import type { Interaction } from "./interaction-helpers.js";

export type UpstreamPurpose = "login" | "link";

const STATE_TTL_SECONDS = 10 * 60;

export function stateCookieName(services: AppServices): string {
	return services.issuer.startsWith("https:")
		? "__Host-upstream_state"
		: "upstream_state";
}

/**
 * Set and cleared with the same attributes, or browsers keep the cookie.
 * SameSite=Lax: Apple's cross-site form_post does not carry it, so its
 * callback answers with a same-site GET that does (upstream-callback.ts).
 */
export function stateCookieOptions(services: AppServices): {
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
 * Whether the sign-in of `interaction` must be a fresh authentication: the
 * client asked for `prompt=login` or `max_age=0`, or the IdP session is
 * older than its `max_age` (oidc-provider reasons `login_prompt`, `max_age`).
 */
export function freshLoginRequired(interaction: Interaction): boolean {
	const { prompt, max_age: maxAge } = interaction.params;
	const reasons = interaction.prompt.reasons;
	return (
		(typeof prompt === "string" && prompt.split(" ").includes("login")) ||
		maxAge === "0" ||
		maxAge === 0 ||
		reasons.includes("login_prompt") ||
		reasons.includes("max_age")
	);
}

/**
 * Providers that can prove a fresh authentication (`auth_time` of their ID
 * token): Google (asked with prompt=login) and Apple. GitHub cannot, so a
 * sign-in that must be fresh never offers or accepts it.
 */
const FRESH_LOGIN_PROVIDERS: ReadonlySet<UpstreamProvider> = new Set([
	"google",
	"apple",
]);

/** The configured providers `interaction` may sign in with. */
export function signInProviders(
	services: AppServices,
	interaction: Interaction,
): UpstreamProvider[] {
	const all = [...services.upstreams.keys()];
	return freshLoginRequired(interaction)
		? all.filter((provider) => FRESH_LOGIN_PROVIDERS.has(provider))
		: all;
}

/**
 * Redirects to Google, GitHub or Apple. The state is random, bound to this browser
 * by an HttpOnly cookie and stored hashed with the PKCE verifier, the nonce
 * and the purpose, for ten minutes and one use.
 */
export async function startUpstream(
	services: AppServices,
	res: Response,
	client: UpstreamClient,
	purpose: UpstreamPurpose,
	binding: {
		readonly uid?: string;
		readonly accountId?: string;
		/** See `freshLoginRequired`; remembered for the callback's checks. */
		readonly freshLogin?: boolean;
	},
): Promise<void> {
	const checks = {
		state: randomToken(),
		codeVerifier: randomToken(),
		nonce: randomToken(),
		freshLogin: binding.freshLogin === true,
	};
	const url = await client.authorizationUrl(checks);
	const data = {
		provider: client.provider,
		purpose,
		verifier: checks.codeVerifier,
		nonce: checks.nonce,
		...(binding.uid ? { uid: binding.uid } : {}),
		...(checks.freshLogin ? { freshLogin: "1" } : {}),
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
