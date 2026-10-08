import type Provider from "oidc-provider";
import {
	type Interaction,
	interactionClientId,
} from "./interaction-helpers.js";

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** Scopes the authorization request asked for. */
export function requestedScopes(interaction: Interaction): string[] {
	const scope: unknown = interaction.params.scope;
	return typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
}

/**
 * Saves the grant that answers a consent prompt and returns its id. It
 * covers what the request asked for: whatever the previous grant already
 * held of it, plus what the prompt reports missing. `fresh` starts a new
 * grant instead of extending the previous one; device logins use it so each
 * machine has its own grant and can be revoked alone.
 */
export async function saveConsentGrant(
	provider: Provider,
	interaction: Interaction,
	accountId: string,
	fresh: boolean,
): Promise<string> {
	const clientId = interactionClientId(interaction);
	const found = interaction.grantId
		? await provider.Grant.find(interaction.grantId)
		: undefined;
	const previous =
		found && found.accountId === accountId && found.clientId === clientId
			? found
			: undefined;
	const grant =
		previous && !fresh ? previous : new provider.Grant({ accountId, clientId });

	if (previous && grant !== previous) {
		const requested = new Set(requestedScopes(interaction));
		const oidcScope = previous.getOIDCScopeFiltered(requested);
		if (oidcScope) grant.addOIDCScope(oidcScope);
		const claims = previous.getOIDCClaims();
		if (claims.length > 0) grant.addOIDCClaims(claims);
		for (const indicator of Object.keys(previous.resources ?? {})) {
			const scope = previous.getResourceScopeFiltered(indicator, requested);
			if (scope) grant.addResourceScope(indicator, scope);
		}
	}

	const { details } = interaction.prompt;
	const missingScope = stringArray(details.missingOIDCScope);
	if (missingScope.length > 0) grant.addOIDCScope(missingScope.join(" "));
	const missingClaims = stringArray(details.missingOIDCClaims);
	if (missingClaims.length > 0) grant.addOIDCClaims(missingClaims);
	const missingResourceScopes: unknown = details.missingResourceScopes;
	if (typeof missingResourceScopes === "object" && missingResourceScopes) {
		for (const [indicator, scopes] of Object.entries(missingResourceScopes)) {
			const list = stringArray(scopes);
			if (list.length > 0) grant.addResourceScope(indicator, list.join(" "));
		}
	}
	return grant.save();
}
