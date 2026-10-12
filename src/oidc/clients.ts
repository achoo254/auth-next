import type { ClientMetadata } from "oidc-provider";
import type { Env } from "../config/env.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_SCOPES,
	RESOURCES,
	TELEGRAM_SCOPE,
	TUNNEL_SCOPES,
} from "./resources.js";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** RFC 8693; only localman-web may use it (see token-exchange.ts). */
export const TOKEN_EXCHANGE_GRANT =
	"urn:ietf:params:oauth:grant-type:token-exchange";

export const STATIC_CLIENT_IDS = {
	localmanWeb: "localman-web",
	tuneloCli: "tunelo-cli",
	tuneloWeb: "tunelo-web",
	/** The IdP's own /account pages; signs the user in, never redeems a code. */
	accountPortal: "hoandat-account",
} as const;

/** Where the IdP sends the browser back after signing in for /account. */
export const ACCOUNT_PORTAL_CALLBACK_PATH = "/account/callback";

const STATIC_ID_SET: ReadonlySet<string> = new Set(
	Object.values(STATIC_CLIENT_IDS),
);

/**
 * First-party confidential apps, trusted to introspect any token (they act
 * for the user across Localman and Tunelo).
 */
export const TRUSTED_INTROSPECTION_CLIENT_IDS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
]);

/** Static clients are declared here; any other client came through DCR. */
export function isStaticClientId(clientId: unknown): boolean {
	return typeof clientId === "string" && STATIC_ID_SET.has(clientId);
}

/**
 * Clients whose refresh tokens are bound to the IdP browser session instead
 * of `offline_access`: every DCR (MCP) client, Localman web (Jev 0.94) and
 * the Tunelo web console (Jev 1.00): signing out at the IdP ends their grant
 * and refresh tokens, even when a back-channel logout is lost.
 */
const SESSION_BOUND_STATIC_CLIENTS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
]);

export function refreshesWithSession(clientId: string): boolean {
	return (
		!isStaticClientId(clientId) || SESSION_BOUND_STATIC_CLIENTS.has(clientId)
	);
}

function scopeOf(...groups: readonly (readonly string[])[]): string {
	return groups.flat().join(" ");
}

/** Absolute URL of `path` on the app at `base` (ignores any base path). */
function appUrl(base: string, path: string): string {
	return new URL(path, base).href;
}

/**
 * The first-party clients. Secrets and app origins come from the
 * environment so local and staging deployments can point elsewhere.
 */
export function buildStaticClients(env: Env): ClientMetadata[] {
	const localman = env.LOCALMAN_WEB_URL;
	const tunelo = env.TUNELO_WEB_URL;
	return [
		{
			client_id: STATIC_CLIENT_IDS.localmanWeb,
			client_name: "Localman",
			client_secret: env.LOCALMAN_WEB_CLIENT_SECRET,
			token_endpoint_auth_method: "client_secret_basic",
			// Token exchange: a user's Localman session buys a short
			// tunnels:read token for Tunelo's API.
			grant_types: [
				"authorization_code",
				"refresh_token",
				TOKEN_EXCHANGE_GRANT,
			],
			response_types: ["code"],
			redirect_uris: [appUrl(localman, "/auth/callback")],
			post_logout_redirect_uris: [appUrl(localman, "/")],
			backchannel_logout_uri: appUrl(localman, "/auth/backchannel-logout"),
			backchannel_logout_session_required: true,
			// No offline_access: its refresh tokens live with the IdP session.
			// `telegram`: the linked chat for Localman's own notification bot.
			scope: scopeOf(
				["openid", "profile", "email", TELEGRAM_SCOPE],
				LOCALMAN_SCOPES,
			),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.localman],
		},
		{
			client_id: STATIC_CLIENT_IDS.tuneloCli,
			client_name: "Tunelo CLI",
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: [DEVICE_CODE_GRANT, "refresh_token"],
			response_types: [],
			redirect_uris: [],
			scope: scopeOf(["openid", "offline_access"], TUNNEL_SCOPES),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.tunnel],
		},
		{
			client_id: STATIC_CLIENT_IDS.tuneloWeb,
			client_name: "Tunelo",
			client_secret: env.TUNELO_WEB_CLIENT_SECRET,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [appUrl(tunelo, "/auth/callback")],
			post_logout_redirect_uris: [appUrl(tunelo, "/")],
			backchannel_logout_uri: appUrl(tunelo, "/auth/backchannel-logout"),
			backchannel_logout_session_required: true,
			// No offline_access: its refresh tokens live with the IdP session.
			scope: scopeOf(["openid", "profile", "email"], TUNNEL_SCOPES),
			[ALLOWED_RESOURCES_PROPERTY]: [RESOURCES.tunnel],
		},
		{
			// Public client with PKCE: /account starts an ordinary
			// authorization request so sign-in goes through the same login
			// pages, then only the IdP session cookie matters.
			client_id: STATIC_CLIENT_IDS.accountPortal,
			client_name: "Tài khoản hoandat",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			redirect_uris: [appUrl(env.ISSUER, ACCOUNT_PORTAL_CALLBACK_PATH)],
			scope: "openid",
			[ALLOWED_RESOURCES_PROPERTY]: [],
		},
	];
}
