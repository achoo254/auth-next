import type { Db } from "mongodb";
import Provider, { type Configuration } from "oidc-provider";
import type { Env } from "../config/env.js";
import { DEVICE_NAME_EXTRA_PARAM } from "../interactions/device-info.js";
import {
	deviceSuccessSource,
	userCodeConfirmSource,
	userCodeInputSource,
} from "../interactions/device-verify-page.js";
import { renderProviderError } from "../interactions/error-page.js";
import {
	logoutSource,
	postLogoutSuccessSource,
} from "../interactions/logout-page.js";
import type { Logger } from "../logger.js";
import {
	type AccountStore,
	CLAIMS_BY_SCOPE,
	createFindAccount,
} from "./claims.js";
import {
	TRUSTED_INTROSPECTION_CLIENT_IDS,
	buildStaticClients,
	refreshesWithSession,
} from "./clients.js";
import { cookieConfig } from "./cookies.js";
import {
	buildInteractionPolicy,
	promptValuesSupported,
} from "./interaction-policy.js";
import { SIGNING_ALG, type SigningJwks } from "./jwks.js";
import { createMongoAdapterFactory } from "./mongo-adapter.js";
import { logProviderEvents } from "./provider-logging.js";
import { validateClientMetadata } from "./registration-policy.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	SUPPORTED_SCOPES,
	defaultResource,
	getResourceServerInfo,
} from "./resources.js";
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

export interface ProviderDependencies {
	readonly env: Env;
	readonly db: Db;
	readonly jwks: SigningJwks;
	readonly accountStore: AccountStore;
	readonly logger: Logger;
}

export function buildProviderConfiguration(
	deps: Omit<ProviderDependencies, "logger">,
): Configuration {
	const { env, db, jwks, accountStore } = deps;
	const policy = buildInteractionPolicy(accountStore);
	return {
		adapter: createMongoAdapterFactory(db),
		clients: buildStaticClients(env),
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
		enabledJWA: { idTokenSigningAlgValues: [SIGNING_ALG] },
		extraClientMetadata: {
			properties: [ALLOWED_RESOURCES_PROPERTY],
			validator: validateClientMetadata,
		},
		pkce: { required: () => true },
		routes: OIDC_ROUTES,
		interactions: {
			policy,
			url: async (_ctx, interaction) =>
				`${INTERACTION_PATH}/${interaction.uid}`,
		},
		discovery: { prompt_values_supported: promptValuesSupported(policy) },
		// Tunelo CLI names the machine so the approval page can show it.
		extraParams: DEVICE_NAME_EXTRA_PARAM,
		renderError: renderProviderError,
		formats: { customizers: { jwt: addActorClaims } },
		cookies: cookieConfig(env.ISSUER, env.COOKIE_KEYS),
		ttl: { ...TTL_SECONDS, RefreshToken: refreshTokenTtl },
		// Every refresh rotates (presenting a consumed one revokes the grant)
		// and slides the grant: 30 days idle, 90 days at most.
		rotateRefreshToken: createRotateAndSlideGrant(db),
		// MCP clients and Localman web hold no offline_access, yet need refresh
		// tokens to outlive the 15-minute access token; theirs die with the
		// IdP session (and logout revokes their grant).
		issueRefreshToken: async (_ctx, client, code) =>
			client.grantTypeAllowed("refresh_token") &&
			(code.scopes.has("offline_access") ||
				refreshesWithSession(client.clientId)),
		features: {
			devInteractions: { enabled: false },
			deviceFlow: {
				enabled: true,
				userCodeInputSource,
				userCodeConfirmSource,
				successSource: deviceSuccessSource,
			},
			// A client may only revoke its own tokens.
			revocation: {
				enabled: true,
				allowedPolicy: async (_ctx, client, token) =>
					token.clientId === client.clientId,
			},
			introspection: {
				enabled: true,
				// A client sees only its own tokens, except the first-party
				// confidential apps; others get the plain `active: false`.
				allowedPolicy: async (_ctx, client, token) =>
					token.clientId === client.clientId ||
					TRUSTED_INTROSPECTION_CLIENT_IDS.has(client.clientId),
			},
			rpInitiatedLogout: {
				enabled: true,
				logoutSource,
				postLogoutSuccessSource,
			},
			backchannelLogout: { enabled: true },
			userinfo: { enabled: true },
			registration: { enabled: true, initialAccessToken: false },
			resourceIndicators: {
				enabled: true,
				defaultResource,
				getResourceServerInfo,
				useGrantedResource: async () => true,
			},
		},
	};
}

/**
 * Builds the OIDC provider. `proxy` is on because the HTTP layer rewrites
 * X-Forwarded-* to what Express derived from trusted proxies only, so Koa
 * sees the original protocol and client IP and nothing a client forged.
 */
export function createProvider(deps: ProviderDependencies): Provider {
	const provider = new Provider(
		deps.env.ISSUER,
		buildProviderConfiguration(deps),
	);
	provider.proxy = true;
	enableTokenExchange(provider, deps.accountStore);
	logProviderEvents(provider, deps.logger);
	return provider;
}
