import { interactionPolicy } from "oidc-provider";
import type { AccountStore } from "./claims.js";
import { isStaticClientId } from "./clients.js";

/** The prompt of OpenID Connect Prompt Create 1.0 ("start with sign-up"). */
export const CREATE_PROMPT = "create";

/**
 * `prompt=create`: show the sign-up page first. oidc-provider's built-in
 * check for a requestable prompt stays pending until the interaction result
 * carries a key named after the prompt; here any completed sign-in answers
 * it (a new account, or an existing one through "Đã có tài khoản? Đăng
 * nhập"), so the check is replaced by one keyed on the login result. It
 * also applies with a live session, as the spec asks.
 */
function createPrompt(): interactionPolicy.Prompt {
	const create = new interactionPolicy.Prompt({
		name: CREATE_PROMPT,
		requestable: true,
	});
	create.checks.remove(`${CREATE_PROMPT}_prompt`);
	create.checks.add(
		new interactionPolicy.Check(
			`${CREATE_PROMPT}_prompt`,
			"account creation was requested",
			"interaction_required",
			(ctx) =>
				ctx.oidc.prompts.has(CREATE_PROMPT) &&
				ctx.oidc.result?.login === undefined,
		),
	);
	return create;
}

/** `prompt_values_supported` for discovery: "none" plus every requestable prompt. */
export function promptValuesSupported(
	policy: interactionPolicy.DefaultPolicy,
): string[] {
	return [
		"none",
		...policy.filter((prompt) => prompt.requestable).map(({ name }) => name),
	];
}

/**
 * oidc-provider's default login and consent prompts, preceded by `create`
 * (OIDC Prompt Create), plus a login rule
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
	policy.add(createPrompt(), 0);
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
