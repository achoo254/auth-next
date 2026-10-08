import { errors } from "oidc-provider";
import { RESOURCES } from "./resources.js";

/** RFC 8693 token type of an OAuth access token. */
export const ACCESS_TOKEN_TYPE =
	"urn:ietf:params:oauth:token-type:access_token";

/** The only target and scope a token exchange may produce. */
export const EXCHANGE_TARGET = RESOURCES.tunnel;
export const EXCHANGE_SCOPE = "tunnels:read";

/** Parameters the token endpoint keeps for this grant (RFC 8693 §2.1). */
export const EXCHANGE_PARAMETERS = [
	"subject_token",
	"subject_token_type",
	"requested_token_type",
	"actor_token",
	"actor_token_type",
	"resource",
	"audience",
	"scope",
] as const;

/** RFC 8693 lets a client name several targets; each is checked. */
export const EXCHANGE_REPEATABLE_PARAMETERS = ["resource", "audience"] as const;

export interface ExchangeRequest {
	readonly subjectToken: string;
}

type Params = Readonly<Record<string, unknown>>;

/** One value; oidc-provider already rejected repeats of this parameter. */
function single(params: Params, name: string): string | undefined {
	const value = params[name];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new errors.InvalidRequest(`${name} must be a non-empty string`);
	}
	return value;
}

function list(params: Params, name: string): string[] {
	const value = params[name];
	if (value === undefined) return [];
	const values = Array.isArray(value) ? value : [value];
	if (!values.every((item) => typeof item === "string" && item.length > 0)) {
		throw new errors.InvalidRequest(`${name} must be a non-empty string`);
	}
	return values;
}

/**
 * Checks everything about the request except the subject token itself:
 * token types, the target (only Tunelo) and the scope (only tunnels:read,
 * which is also the default). Throws the RFC 8693 / RFC 6749 error.
 */
export function parseExchangeRequest(params: Params): ExchangeRequest {
	const subjectToken = single(params, "subject_token");
	if (!subjectToken) {
		throw new errors.InvalidRequest("subject_token is required");
	}
	if (single(params, "subject_token_type") !== ACCESS_TOKEN_TYPE) {
		throw new errors.InvalidRequest(
			`subject_token_type must be ${ACCESS_TOKEN_TYPE}`,
		);
	}
	const requested = single(params, "requested_token_type");
	if (requested !== undefined && requested !== ACCESS_TOKEN_TYPE) {
		throw new errors.InvalidRequest(
			`requested_token_type must be ${ACCESS_TOKEN_TYPE}`,
		);
	}
	if (
		params.actor_token !== undefined ||
		params.actor_token_type !== undefined
	) {
		throw new errors.InvalidRequest(
			"actor_token is not supported; the authenticated client is the actor",
		);
	}

	const targets = [...list(params, "resource"), ...list(params, "audience")];
	if (targets.length === 0) {
		throw new errors.InvalidRequest(
			`resource or audience is required (${EXCHANGE_TARGET})`,
		);
	}
	if (targets.some((target) => target !== EXCHANGE_TARGET)) {
		throw new errors.InvalidTarget(
			`tokens can only be exchanged for ${EXCHANGE_TARGET}`,
		);
	}

	const scope = single(params, "scope");
	if (scope !== undefined) {
		const scopes = new Set(scope.split(" ").filter(Boolean));
		if (scopes.size !== 1 || !scopes.has(EXCHANGE_SCOPE)) {
			throw new errors.InvalidScope(
				`only ${EXCHANGE_SCOPE} can be requested`,
				scope,
			);
		}
	}
	return { subjectToken };
}
