import type { Db } from "mongodb";
import Provider, { type Configuration } from "oidc-provider";
import type { Env } from "../config/env.js";
import type { Logger } from "../logger.js";
import {
	type AccountStore,
	CLAIMS_BY_SCOPE,
	createFindAccount,
} from "./claims.js";
import {
	TRUSTED_INTROSPECTION_CLIENT_IDS,
	buildStaticClients,
	isStaticClientId,
} from "./clients.js";
import { SIGNING_ALG, type SigningJwks } from "./jwks.js";
import { createMongoAdapterFactory } from "./mongo-adapter.js";
import { validateClientMetadata } from "./registration-policy.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	SUPPORTED_SCOPES,
	defaultResource,
	getResourceServerInfo,
} from "./resources.js";

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
	Grant: 30 * DAY,
	IdToken: 15 * MINUTE,
	Interaction: 30 * MINUTE,
	RefreshToken: 30 * DAY,
	Session: 30 * DAY,
} as const;

/**
 * Over https every cookie is Secure. The session cookie lives on "/" and
 * takes the `__Host-` prefix; interaction cookies are scoped to their
 * interaction path, which `__Host-` forbids, so they use `__Secure-`.
 */
export function cookieConfig(
	issuer: string,
	keys: readonly string[],
): NonNullable<Configuration["cookies"]> {
	const secure = new URL(issuer).protocol === "https:";
	const options = { httpOnly: true, sameSite: "lax", secure } as const;
	return {
		keys: [...keys],
		long: options,
		short: options,
		names: secure
			? {
					session: "__Host-session",
					interaction: "__Secure-interaction",
					resume: "__Secure-interaction_resume",
				}
			: {
					session: "_session",
					interaction: "_interaction",
					resume: "_interaction_resume",
				},
	};
}

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
			url: async (_ctx, interaction) =>
				`${INTERACTION_PATH}/${interaction.uid}`,
		},
		cookies: cookieConfig(env.ISSUER, env.COOKIE_KEYS),
		ttl: { ...TTL_SECONDS },
		// Every refresh rotates; presenting a consumed one revokes the grant.
		rotateRefreshToken: true,
		// MCP clients cannot request offline_access (their scopes are fixed),
		// yet still need refresh tokens to outlive the 15-minute access token.
		issueRefreshToken: async (_ctx, client, code) =>
			client.grantTypeAllowed("refresh_token") &&
			(code.scopes.has("offline_access") || !isStaticClientId(client.clientId)),
		features: {
			devInteractions: { enabled: false },
			deviceFlow: { enabled: true },
			revocation: { enabled: true },
			introspection: {
				enabled: true,
				// A client sees only its own tokens, except the first-party
				// confidential apps; others get the plain `active: false`.
				allowedPolicy: async (_ctx, client, token) =>
					token.clientId === client.clientId ||
					TRUSTED_INTROSPECTION_CLIENT_IDS.has(client.clientId),
			},
			rpInitiatedLogout: { enabled: true },
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
	provider.on("server_error", (ctx, error) => {
		deps.logger.error(
			{ err: error, route: ctx.oidc?.route },
			"OIDC provider server error",
		);
	});
	provider.on("grant.revoked", (_ctx, grantId) => {
		deps.logger.info({ grantId }, "Grant revoked");
	});
	return provider;
}
