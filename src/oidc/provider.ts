import type { Db } from "mongodb";
import Provider, { type Configuration } from "oidc-provider";
import { LOCALES } from "../i18n/locales.js";
import { DEVICE_NAME_EXTRA_PARAM } from "../interactions/device-info.js";
import { renderProviderError } from "../interactions/error-page.js";
import type { Logger } from "../logger.js";
import { resourcesFor } from "../tenants/tenant-resources.js";
import type { Tenant } from "../tenants/tenant.js";
import {
	type AccountStore,
	CLAIMS_BY_SCOPE,
	createFindAccount,
} from "./claims.js";
import {
	type StaticClientSecrets,
	buildStaticClients,
	refreshesPerDevice,
	refreshesWithSession,
} from "./clients.js";
import { cookieConfig } from "./cookies.js";
import { ignoreOfflineAccessOfDynamicClients } from "./dynamic-client-scopes.js";
import {
	buildInteractionPolicy,
	promptValuesSupported,
} from "./interaction-policy.js";
import { SIGNING_ALG, type SigningJwks, idTokenSigningAlgs } from "./jwks.js";
import { createMongoAdapterFactory } from "./mongo-adapter.js";
import { buildProviderFeatures } from "./provider-features.js";
import { logProviderEvents } from "./provider-logging.js";
import { createClientMetadataValidator } from "./registration-policy.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	type ResourcePolicy,
	SUPPORTED_SCOPES,
	createResourcePolicy,
} from "./resources.js";
import type { ScribeClientsConfig } from "./scribe-clients.js";
import {
	GRANT_IDLE_SECONDS,
	createRotateAndSlideGrant,
	refreshTokenTtl,
} from "./sliding-grants.js";
import { addActorClaims, enableTokenExchange } from "./token-exchange.js";

/**
 * Endpoint paths, declared once so the HTTP layer (rate limits) and the
 * provider agree. Values are oidc-provider's defaults; clients must still
 * read them from discovery rather than hardcode them.
 */
export const OIDC_ROUTES = {
	authorization: "/auth",
	code_verification: "/device",
	device_authorization: "/device/auth",
	end_session: "/session/end",
	introspection: "/token/introspection",
	jwks: "/jwks",
	pushed_authorization_request: "/request",
	registration: "/reg",
	revocation: "/token/revocation",
	token: "/token",
	userinfo: "/me",
} as const;

export const INTERACTION_PATH = "/interaction";

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

export const TTL_SECONDS = {
	AccessToken: 15 * MINUTE,
	AuthorizationCode: MINUTE,
	DeviceCode: 10 * MINUTE,
	/** Initial lifetime; refreshes slide it up to 90 days (sliding-grants.ts). */
	Grant: GRANT_IDLE_SECONDS,
	IdToken: 15 * MINUTE,
	Interaction: 30 * MINUTE,
	Session: 30 * DAY,
} as const;

/** Everything one tenant's provider is built from. */
export interface ProviderDependencies {
	readonly tenant: Tenant;
	readonly db: Db;
	readonly jwks: SigningJwks;
	/** Keys signing the provider's cookies (shared by every tenant). */
	readonly cookieKeys: readonly string[];
	readonly clientSecrets: StaticClientSecrets;
	/** Redirect of the chat mobile app; one value for every tenant. */
	readonly chatMobileRedirectUri: string;
	/** Scribe's clients; honoured for the primary tenant only. */
	readonly scribeClients?: ScribeClientsConfig;
	readonly accountStore: AccountStore;
	readonly logger: Logger;
}

/** The tenant's resources (audiences) and how tokens for them are issued. */
export function tenantResourcePolicy(
	tenant: Pick<Tenant, "domain">,
): ResourcePolicy {
	return createResourcePolicy(resourcesFor(tenant.domain));
}

export function buildProviderConfiguration(
	deps: Omit<ProviderDependencies, "logger">,
): Configuration {
	const { tenant, db, jwks, accountStore } = deps;
	const resources = tenantResourcePolicy(tenant);
	const policy = buildInteractionPolicy();
	return {
		adapter: createMongoAdapterFactory(db, tenant),
		clients: buildStaticClients(
			tenant,
			resources.resources,
			deps.clientSecrets,
			deps.chatMobileRedirectUri,
			deps.scribeClients,
		),
		findAccount: createFindAccount(accountStore),
		jwks: { keys: jwks.keys.map((key) => ({ ...key })) },
		claims: CLAIMS_BY_SCOPE,
		scopes: SUPPORTED_SCOPES,
		// Authorization Code only: no implicit or hybrid tokens in the front channel.
		responseTypes: ["code"],
		clientDefaults: {
			grant_types: ["authorization_code"],
			response_types: ["code"],
			token_endpoint_auth_method: "client_secret_basic",
			id_token_signed_response_alg: SIGNING_ALG,
		},
		enabledJWA: { idTokenSigningAlgValues: idTokenSigningAlgs(jwks) },
		extraClientMetadata: {
			properties: [ALLOWED_RESOURCES_PROPERTY],
			validator: createClientMetadataValidator(resources),
		},
		pkce: { required: () => true },
		routes: OIDC_ROUTES,
		interactions: {
			policy,
			url: async (_ctx, interaction) =>
				`${INTERACTION_PATH}/${interaction.uid}`,
		},
		discovery: {
			prompt_values_supported: promptValuesSupported(policy),
			ui_locales_supported: [...LOCALES],
		},
		// Tunelo CLI names the machine so the approval page can show it.
		extraParams: DEVICE_NAME_EXTRA_PARAM,
		renderError: renderProviderError,
		formats: { customizers: { jwt: addActorClaims } },
		cookies: cookieConfig(tenant.issuer, deps.cookieKeys),
		ttl: { ...TTL_SECONDS, RefreshToken: refreshTokenTtl },
		// Every refresh rotates (presenting a consumed one revokes the grant)
		// and slides the grant: 30 days idle, 90 days at most.
		rotateRefreshToken: createRotateAndSlideGrant({ db, tenant }),
		// MCP clients and Localman web hold no offline_access, yet need refresh
		// tokens to outlive the 15-minute access token; theirs die with the
		// IdP session (and logout revokes their grant).
		// The chat mobile and desktop apps hold no offline_access either; their
		// refresh tokens belong to the device and outlive the IdP session.
		issueRefreshToken: async (_ctx, client, code) =>
			client.grantTypeAllowed("refresh_token") &&
			(code.scopes.has("offline_access") ||
				refreshesWithSession(client.clientId) ||
				refreshesPerDevice(client.clientId)),
		expiresWithSession: async (ctx, token) =>
			!token.scopes.has("offline_access") &&
			!refreshesPerDevice(ctx.oidc.client?.clientId),
		features: buildProviderFeatures(resources),
	};
}

/**
 * Builds the OIDC provider. `proxy` is on because the HTTP layer rewrites
 * X-Forwarded-* to what Express derived from trusted proxies only, so Koa
 * sees the original protocol and client IP and nothing a client forged.
 */
export function createProvider(deps: ProviderDependencies): Provider {
	const provider = new Provider(
		deps.tenant.issuer,
		buildProviderConfiguration(deps),
	);
	provider.proxy = true;
	enableTokenExchange(
		provider,
		deps.accountStore,
		tenantResourcePolicy(deps.tenant),
	);
	ignoreOfflineAccessOfDynamicClients(provider, OIDC_ROUTES.authorization);
	logProviderEvents(provider, deps.logger);
	return provider;
}
