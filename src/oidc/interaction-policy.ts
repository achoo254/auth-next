import { interactionPolicy } from "oidc-provider";
import type { AccountStore } from "./claims.js";
import { isStaticClientId } from "./clients.js";

/**
 * oidc-provider's default login and consent prompts, plus a login rule
 * (pending security review, below) and one consent rule: a
 * dynamically registered (MCP) client always shows the consent page, even
 * when an earlier grant already covers what it asks for. Nobody vouches for
 * such a client, so every authorization is confirmed by the user. Native
 * clients (Tunelo CLI device logins) already always prompt by default.
 */
export function buildInteractionPolicy(
	accounts: AccountStore,
): interactionPolicy.DefaultPolicy {
	const policy = interactionPolicy.base();
	const login = policy.get("login");
	if (!login) throw new Error("oidc-provider has no login prompt");
	// After a password reset nothing is signed in silently: every request,
	// even with a live session, goes through the login page and from there
	// to the mandatory security review.
	login.checks.add(
		new interactionPolicy.Check(
			"security_review_pending",
			"a password reset must be reviewed first",
			"login_required",
			async (ctx) => {
				const accountId = ctx.oidc.session?.accountId;
				if (!accountId || ctx.oidc.result?.login) return false;
				return (
					(await accounts.findAccount(accountId))?.securityReviewPending ===
					true
				);
			},
		),
	);
	const consent = policy.get("consent");
	if (!consent) throw new Error("oidc-provider has no consent prompt");
	consent.checks.add(
		new interactionPolicy.Check(
			"dynamic_client_prompt",
			"dynamically registered clients require End-User consent",
			"interaction_required",
			(ctx) =>
				!isStaticClientId(ctx.oidc.client?.clientId) &&
				ctx.oidc.result?.consent === undefined,
		),
	);
	return policy;
}
