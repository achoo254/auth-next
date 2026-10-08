import {
	type ClientMetadata,
	type KoaContextWithOIDC,
	errors,
} from "oidc-provider";
import { isStaticClientId } from "./clients.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_SCOPES,
	RESOURCES,
	isResourceIndicator,
} from "./resources.js";

/** Scopes a dynamically registered (MCP) client may hold. */
export const DCR_ALLOWED_SCOPES: readonly string[] = LOCALMAN_SCOPES;

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

/** Names reserved for first-party apps, matched on a lookalike skeleton. */
const RESERVED_NAME_PATTERN = /localman|tunelo|hoandat/;

// Cyrillic and Greek letters that render like the Latin letters of the
// reserved names; NFKC alone keeps them distinct.
const CONFUSABLE_LETTERS: Readonly<Record<string, string>> = {
	"\u0430": "a", // Cyrillic а
	"\u0441": "c", // Cyrillic с
	"\u0435": "e", // Cyrillic е
	"\u043e": "o", // Cyrillic о
	"\u04bb": "h", // Cyrillic һ
	"\u0501": "d", // Cyrillic ԁ
	"\u04cf": "l", // Cyrillic ӏ
	"\u03b1": "a", // Greek α
	"\u03bf": "o", // Greek ο
	"\u03b9": "l", // Greek ι
};

/**
 * Reduces a display name to a skeleton so "Locaⅼman", "L o c a l m a n",
 * "LocaIman" or Cyrillic lookalikes still match a reserved name.
 */
function nameSkeleton(name: string): string {
	return [...name.normalize("NFKC").toLowerCase()]
		.map((char) => CONFUSABLE_LETTERS[char] ?? char)
		.join("")
		.replace(/[1|!i]/g, "l")
		.replace(/0/g, "o")
		.replace(/[^a-z]/g, "");
}

export function imitatesFirstPartyName(name: string): boolean {
	return RESERVED_NAME_PATTERN.test(nameSkeleton(name));
}

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function isAllowedRedirect(uri: string): boolean {
	const parsed = URL.parse(uri);
	if (!parsed) return false;
	if (parsed.protocol === "https:") return true;
	return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
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

/** MCP clients: Localman scopes only, loopback or https redirects, /mcp only. */
function enforceDynamicClientPolicy(metadata: ClientMetadata): void {
	const resources = stringList(metadata[ALLOWED_RESOURCES_PROPERTY]);
	if (
		metadata[ALLOWED_RESOURCES_PROPERTY] !== undefined &&
		(resources.length !== 1 || resources[0] !== RESOURCES.localmanMcp)
	) {
		throw new errors.InvalidClientMetadata(
			`${ALLOWED_RESOURCES_PROPERTY} is assigned by the authorization server`,
		);
	}
	metadata[ALLOWED_RESOURCES_PROPERTY] = [RESOURCES.localmanMcp];

	for (const property of DCR_FORBIDDEN_METADATA) {
		if (metadata[property] !== undefined) {
			throw new errors.InvalidClientMetadata(`${property} is not supported`);
		}
	}
	if (
		typeof metadata.client_name === "string" &&
		imitatesFirstPartyName(metadata.client_name)
	) {
		throw new errors.InvalidClientMetadata(
			"client_name must not imitate a first-party application",
		);
	}

	const scopes =
		typeof metadata.scope === "string"
			? metadata.scope.split(" ").filter(Boolean)
			: [];
	rejectOutside("scope", scopes, new Set(DCR_ALLOWED_SCOPES));
	metadata.scope = (scopes.length > 0 ? scopes : DCR_ALLOWED_SCOPES).join(" ");

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

/**
 * `extraClientMetadata.validator`: runs for every client construction, static
 * or dynamic, including when a registered client is loaded back from Mongo.
 * Static clients must list known resources; every other client is a DCR
 * (MCP) client and gets the restrictive policy above.
 */
export function validateClientMetadata(
	_ctx: KoaContextWithOIDC | undefined,
	key: string,
	_value: unknown,
	metadata: ClientMetadata,
): void {
	if (key !== ALLOWED_RESOURCES_PROPERTY) return;
	if (!isStaticClientId(metadata.client_id)) {
		enforceDynamicClientPolicy(metadata);
		return;
	}
	const resources = stringList(metadata[ALLOWED_RESOURCES_PROPERTY]);
	if (resources.length === 0 || !resources.every(isResourceIndicator)) {
		throw new errors.InvalidClientMetadata(
			`${ALLOWED_RESOURCES_PROPERTY} must list known resource indicators`,
		);
	}
}
