import {
	type Client,
	type KoaContextWithOIDC,
	type ResourceServer,
	errors,
} from "oidc-provider";
import type { TenantResources } from "../tenants/tenant-resources.js";
import { SIGNING_ALG } from "./jwks.js";

/** Localman API scopes, shared by the web API and its MCP endpoint. */
export const LOCALMAN_SCOPES = [
	"mock:read",
	"mock:write",
	"client:read",
	"client:write",
	"client:send",
] as const;

/**
 * Lets an MCP client mint Localman credentials for the user (personal access
 * tokens, service account secrets, access keys). Only the MCP resource has
 * it, and no client holds it by default: a DCR client must register it
 * explicitly, and consent shows it with a warning.
 */
export const CREDENTIALS_SCOPE = "credentials:write";

/** Scopes the Localman MCP endpoint accepts. */
export const LOCALMAN_MCP_SCOPES = [...LOCALMAN_SCOPES, CREDENTIALS_SCOPE];

export const TUNNEL_SCOPES = ["tunnels:open", "tunnels:read"] as const;

/**
 * The linked Telegram chat, at userinfo only; just `localman-web` may ask
 * (its own bot sends the user's notifications there).
 */
export const TELEGRAM_SCOPE = "telegram";

/**
 * Manages the account itself through /api/account; only the iOS account
 * app (`account-ios`) holds it. Carried by its opaque access token, never
 * by a resource (audience-bound JWT).
 */
export const ACCOUNT_SCOPE = "account";

/** Every scope the issuer supports: OIDC scopes plus all resource scopes. */
export const SUPPORTED_SCOPES = [
	"openid",
	"offline_access",
	"profile",
	"email",
	TELEGRAM_SCOPE,
	ACCOUNT_SCOPE,
	...LOCALMAN_MCP_SCOPES,
	...TUNNEL_SCOPES,
];

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Client metadata listing the resource indicators a client may target. */
export const ALLOWED_RESOURCES_PROPERTY = "allowed_resources";

/**
 * How a tenant's resources are issued: which indicators exist, which scopes
 * each carries, and which a client may target. Built once per tenant, so a
 * token for one tenant's app can never name another tenant's audience.
 */
export interface ResourcePolicy {
	readonly resources: TenantResources;
	isResourceIndicator(value: unknown): value is string;
	allowedResourcesOf(client: Client): readonly string[];
	/** `features.resourceIndicators.getResourceServerInfo` of oidc-provider. */
	getResourceServerInfo(
		ctx: KoaContextWithOIDC,
		resourceIndicator: string,
		client: Client,
	): Promise<ResourceServer>;
	/** How tokens for `resource` are issued, whichever grant issues them. */
	resourceServerInfo(resource: string): ResourceServer;
	/** `features.resourceIndicators.defaultResource` of oidc-provider. */
	defaultResource(
		ctx: KoaContextWithOIDC,
		client: Client,
		oneOf?: readonly string[],
	): Promise<string | readonly string[] | undefined>;
}

export function createResourcePolicy(
	resources: TenantResources,
): ResourcePolicy {
	const scopesByResource = new Map<string, readonly string[]>([
		[resources.localman, LOCALMAN_SCOPES],
		[resources.localmanMcp, LOCALMAN_MCP_SCOPES],
		[resources.tunnel, TUNNEL_SCOPES],
	]);
	const isResourceIndicator = (value: unknown): value is string =>
		typeof value === "string" && scopesByResource.has(value);
	const allowedResourcesOf = (client: Client): readonly string[] => {
		const value: unknown = client[ALLOWED_RESOURCES_PROPERTY];
		return Array.isArray(value) ? value.filter(isResourceIndicator) : [];
	};
	const resourceServerInfo = (resource: string): ResourceServer => ({
		scope: (scopesByResource.get(resource) ?? []).join(" "),
		audience: resource,
		accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
		accessTokenFormat: "jwt",
		jwt: { sign: { alg: SIGNING_ALG } },
	});
	return {
		resources,
		isResourceIndicator,
		allowedResourcesOf,
		resourceServerInfo,
		/**
		 * Access tokens are short-lived ES256 JWTs whose `aud` is the
		 * resource, so each app verifies them offline against the JWKS. A
		 * client only receives tokens for resources pre-registered in its
		 * `allowed_resources`.
		 */
		async getResourceServerInfo(_ctx, resourceIndicator, client) {
			if (
				!isResourceIndicator(resourceIndicator) ||
				!allowedResourcesOf(client).includes(resourceIndicator)
			) {
				throw new errors.InvalidTarget(
					"resource is not allowed for this client",
				);
			}
			return resourceServerInfo(resourceIndicator);
		},
		/**
		 * When a request names no resource but asks for a scope of the
		 * client's only allowed resource, that resource is implied; so a
		 * Tunelo or MCP token is always audience-bound. A plain OpenID request
		 * (`openid profile email`) gets no resource and therefore an opaque
		 * access token for /me.
		 */
		async defaultResource(ctx, client, oneOf) {
			if (oneOf) return oneOf;
			const allowed = allowedResourcesOf(client);
			const only = allowed.length === 1 ? allowed[0] : undefined;
			if (!only) return undefined;
			const scope = ctx.oidc.params?.scope;
			const requested = new Set(
				typeof scope === "string" ? scope.split(" ") : [],
			);
			return (scopesByResource.get(only) ?? []).some((value) =>
				requested.has(value),
			)
				? only
				: undefined;
		},
	};
}
