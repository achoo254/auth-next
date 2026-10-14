import { type ClientMetadata, type Configuration, errors } from "oidc-provider";
import { CLIENTS_WITHOUT_RESOURCES, isStaticClientId } from "./clients.js";
import { withoutOfflineAccess } from "./dynamic-client-scopes.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_MCP_SCOPES,
	LOCALMAN_SCOPES,
	type ResourcePolicy,
} from "./resources.js";

/** Scopes a dynamically registered (MCP) client may hold. */
export const DCR_ALLOWED_SCOPES: readonly string[] = LOCALMAN_MCP_SCOPES;

/** Scope of a DCR client that registers none: `credentials:write` is opt-in. */
export const DCR_DEFAULT_SCOPES: readonly string[] = LOCALMAN_SCOPES;

const DCR_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);
const DCR_RESPONSE_TYPES = new Set(["code"]);
const DCR_AUTH_METHODS = new Set([
	"none",
	"client_secret_basic",
	"client_secret_post",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Metadata a DCR client may not set: URLs the server would fetch
 * (sector_identifier_uri, jwks_uri, backchannel_logout_uri) and branding a
 * consent page could show to make a client look first-party.
 */
const DCR_FORBIDDEN_METADATA = [
	"sector_identifier_uri",
	"jwks_uri",
	"backchannel_logout_uri",
	"logo_uri",
	"client_uri",
	"policy_uri",
	"tos_uri",
] as const;

/** Longest client_name accepted, in characters; it is shown on consent. */
const CLIENT_NAME_MAX_LENGTH = 100;

/**
 * Control, line/paragraph separator and bidi formatting characters: they
 * could break the consent page layout or reorder the name as displayed.
 */
const CLIENT_NAME_FORBIDDEN_CHARS =
	/[\p{Cc}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;

/**
 * client_name is self-declared and shown as such on consent, so any name
 * is accepted, first-party lookalikes included (the consent page warns about
 * those); only its shape is checked.
 */
function checkClientName(name: unknown): void {
	if (name === undefined || name === null) return;
	if (
		typeof name !== "string" ||
		name.trim() === "" ||
		[...name].length > CLIENT_NAME_MAX_LENGTH ||
		CLIENT_NAME_FORBIDDEN_CHARS.test(name)
	) {
		throw new errors.InvalidClientMetadata(
			`client_name must be 1-${CLIENT_NAME_MAX_LENGTH} characters without control or bidi formatting characters`,
		);
	}
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** True for the hosts a native app listens on for its OAuth callback. */
export function isLoopbackHostname(hostname: string): boolean {
	return LOOPBACK_HOSTS.has(hostname);
}

function isAllowedRedirect(uri: string): boolean {
	const parsed = URL.parse(uri);
	if (!parsed) return false;
	if (parsed.protocol === "https:") return true;
	return parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname);
}

function rejectOutside(
	label: string,
	values: readonly string[],
	allowed: ReadonlySet<string>,
): void {
	const extra = values.filter((value) => !allowed.has(value));
	if (extra.length > 0) {
		throw new errors.InvalidClientMetadata(
			`${label} contains values not allowed for dynamically registered clients: ${extra.join(" ")}`,
		);
	}
}

/**
 * MCP clients: Localman MCP scopes only, loopback or https redirects, the
 * tenant's /mcp resource only.
 */
function enforceDynamicClientPolicy(
	metadata: ClientMetadata,
	mcpResource: string,
): void {
	const resources = stringList(metadata[ALLOWED_RESOURCES_PROPERTY]);
	if (
		metadata[ALLOWED_RESOURCES_PROPERTY] !== undefined &&
		(resources.length !== 1 || resources[0] !== mcpResource)
	) {
		throw new errors.InvalidClientMetadata(
			`${ALLOWED_RESOURCES_PROPERTY} is assigned by the authorization server`,
		);
	}
	metadata[ALLOWED_RESOURCES_PROPERTY] = [mcpResource];

	for (const property of DCR_FORBIDDEN_METADATA) {
		if (metadata[property] !== undefined) {
			throw new errors.InvalidClientMetadata(`${property} is not supported`);
		}
	}
	checkClientName(metadata.client_name);

	const scopes = withoutOfflineAccess(
		typeof metadata.scope === "string"
			? metadata.scope.split(" ").filter(Boolean)
			: [],
	);
	rejectOutside("scope", scopes, new Set(DCR_ALLOWED_SCOPES));
	metadata.scope = (scopes.length > 0 ? scopes : DCR_DEFAULT_SCOPES).join(" ");

	rejectOutside(
		"grant_types",
		stringList(metadata.grant_types),
		DCR_GRANT_TYPES,
	);
	rejectOutside(
		"response_types",
		stringList(metadata.response_types),
		DCR_RESPONSE_TYPES,
	);
	rejectOutside(
		"token_endpoint_auth_method",
		stringList([metadata.token_endpoint_auth_method]),
		DCR_AUTH_METHODS,
	);

	for (const property of ["redirect_uris", "post_logout_redirect_uris"]) {
		const invalid = stringList(metadata[property]).filter(
			(uri) => !isAllowedRedirect(uri),
		);
		if (invalid.length > 0) {
			// A description starting with "redirect_uris" maps to invalid_redirect_uri.
			throw new errors.InvalidClientMetadata(
				`${property} must use https or http on localhost/127.0.0.1`,
			);
		}
	}
}

type ClientMetadataValidator = NonNullable<
	NonNullable<Configuration["extraClientMetadata"]>["validator"]
>;

/**
 * `extraClientMetadata.validator` of one tenant: runs for every client
 * construction, static or dynamic, including when a registered client is
 * loaded back from Mongo. Static clients must list the tenant's resources;
 * every other client is a DCR (MCP) client and gets the restrictive policy
 * above.
 */
export function createClientMetadataValidator(
	policy: ResourcePolicy,
): ClientMetadataValidator {
	return (_ctx, key, _value, metadata) => {
		if (key === ALLOWED_RESOURCES_PROPERTY) {
			validateResources(policy, metadata);
		}
	};
}

function validateResources(
	policy: ResourcePolicy,
	metadata: ClientMetadata,
): void {
	if (!isStaticClientId(metadata.client_id)) {
		enforceDynamicClientPolicy(metadata, policy.resources.localmanMcp);
		return;
	}
	// Static clients list known resources; only those that never use an API
	// access token (the account portal, chat) may list none.
	const resources = stringList(metadata[ALLOWED_RESOURCES_PROPERTY]);
	const mayBeEmpty =
		typeof metadata.client_id === "string" &&
		CLIENTS_WITHOUT_RESOURCES.has(metadata.client_id);
	if (
		(resources.length === 0 && !mayBeEmpty) ||
		!resources.every(policy.isResourceIndicator)
	) {
		throw new errors.InvalidClientMetadata(
			`${ALLOWED_RESOURCES_PROPERTY} must list known resource indicators`,
		);
	}
}
