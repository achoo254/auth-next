import {
	type Client,
	type KoaContextWithOIDC,
	type ResourceServer,
	errors,
} from "oidc-provider";
import { SIGNING_ALG } from "./jwks.js";

/** Resource indicators (RFC 8707); each is also the token's `aud`. */
export const RESOURCES = {
	localman: "https://localman.hoandat.com",
	localmanMcp: "https://localman.hoandat.com/mcp",
	tunnel: "https://tunnel.hoandat.com",
} as const;

export type ResourceIndicator = (typeof RESOURCES)[keyof typeof RESOURCES];

/** Localman API scopes, shared by the web API and its MCP endpoint. */
export const LOCALMAN_SCOPES = [
	"mock:read",
	"mock:write",
	"client:read",
	"client:write",
	"client:send",
] as const;

export const TUNNEL_SCOPES = ["tunnels:open", "tunnels:read"] as const;

const SCOPES_BY_RESOURCE: Readonly<
	Record<ResourceIndicator, readonly string[]>
> = {
	[RESOURCES.localman]: LOCALMAN_SCOPES,
	[RESOURCES.localmanMcp]: LOCALMAN_SCOPES,
	[RESOURCES.tunnel]: TUNNEL_SCOPES,
};

/** Every scope the issuer supports: OIDC scopes plus all resource scopes. */
export const SUPPORTED_SCOPES = [
	"openid",
	"offline_access",
	"profile",
	"email",
	...LOCALMAN_SCOPES,
	...TUNNEL_SCOPES,
];

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Client metadata listing the resource indicators a client may target. */
export const ALLOWED_RESOURCES_PROPERTY = "allowed_resources";

export function isResourceIndicator(
	value: unknown,
): value is ResourceIndicator {
	return (
		typeof value === "string" &&
		Object.values<string>(RESOURCES).includes(value)
	);
}

export function allowedResourcesOf(
	client: Client,
): readonly ResourceIndicator[] {
	const value: unknown = client[ALLOWED_RESOURCES_PROPERTY];
	return Array.isArray(value) ? value.filter(isResourceIndicator) : [];
}

/**
 * Access tokens are short-lived ES256 JWTs whose `aud` is the resource, so
 * each app verifies them offline against the JWKS. A client only receives
 * tokens for resources pre-registered in its `allowed_resources`.
 */
export async function getResourceServerInfo(
	_ctx: KoaContextWithOIDC,
	resourceIndicator: string,
	client: Client,
): Promise<ResourceServer> {
	if (
		!isResourceIndicator(resourceIndicator) ||
		!allowedResourcesOf(client).includes(resourceIndicator)
	) {
		throw new errors.InvalidTarget("resource is not allowed for this client");
	}
	return resourceServerInfo(resourceIndicator);
}

/** How tokens for `resource` are issued, whichever grant issues them. */
export function resourceServerInfo(
	resource: ResourceIndicator,
): ResourceServer {
	return {
		scope: SCOPES_BY_RESOURCE[resource].join(" "),
		audience: resource,
		accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
		accessTokenFormat: "jwt",
		jwt: { sign: { alg: SIGNING_ALG } },
	};
}

/**
 * When a request names no resource but asks for a scope of the client's only
 * allowed resource, that resource is implied; so a Tunelo or MCP token is
 * always audience-bound. A plain OpenID request (`openid profile email`)
 * gets no resource and therefore an opaque access token for /me.
 */
export async function defaultResource(
	ctx: KoaContextWithOIDC,
	client: Client,
	oneOf?: readonly string[],
): Promise<string | readonly string[] | undefined> {
	if (oneOf) return oneOf;
	const allowed = allowedResourcesOf(client);
	const only = allowed.length === 1 ? allowed[0] : undefined;
	if (!only) return undefined;
	const scope = ctx.oidc.params?.scope;
	const requested = new Set(typeof scope === "string" ? scope.split(" ") : []);
	return SCOPES_BY_RESOURCE[only].some((value) => requested.has(value))
		? only
		: undefined;
}
