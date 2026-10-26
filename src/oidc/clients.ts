import type { ClientMetadata } from "oidc-provider";
import type { TenantResources } from "../tenants/tenant-resources.js";
import type { Tenant } from "../tenants/tenant.js";
import {
	ACCOUNT_IOS_CLIENT_IDS,
	buildAccountIosClients,
} from "./account-ios-client.js";
import { CHAT_CLIENT_IDS, buildChatClients } from "./chat-clients.js";
import { MIU_CLIENT_IDS, buildMiuClients } from "./miu-clients.js";
import type { PrimaryAppClientsConfig } from "./primary-app-clients.js";
import {
	ALLOWED_RESOURCES_PROPERTY,
	LOCALMAN_SCOPES,
	TELEGRAM_SCOPE,
	TUNNEL_SCOPES,
} from "./resources.js";
import { SCRIBE_CLIENT_IDS, buildScribeClients } from "./scribe-clients.js";
import {
	SIGN_IN_ONLY_CLIENT_IDS,
	type SignInOnlyApps,
	buildSignInOnlyClients,
} from "./sign-in-only-clients.js";

/** Secrets of the tenant's confidential first-party clients (from the environment). */
export interface StaticClientSecrets {
	readonly localmanWeb: string;
	readonly tuneloWeb: string;
	readonly chatWeb: string;
}

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
	...CHAT_CLIENT_IDS,
	...SCRIBE_CLIENT_IDS,
	...MIU_CLIENT_IDS,
	...ACCOUNT_IOS_CLIENT_IDS,
	...SIGN_IN_ONLY_CLIENT_IDS,
} as const;

/** Where the IdP sends the browser back after signing in for /account. */
export const ACCOUNT_PORTAL_CALLBACK_PATH = "/account/callback";

const STATIC_ID_SET: ReadonlySet<string> = new Set(
	Object.values(STATIC_CLIENT_IDS),
);

/** First-party apps acting for the user, trusted to introspect any token. */
export const TRUSTED_INTROSPECTION_CLIENT_IDS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
]);

/** Static clients are declared here; any other client came through DCR. */
export function isStaticClientId(clientId: unknown): boolean {
	return typeof clientId === "string" && STATIC_ID_SET.has(clientId);
}

/**
 * Refresh tokens bound to the IdP browser session instead of offline_access:
 * DCR (MCP) clients, Localman (Jev 0.94), Tunelo (Jev 1.00), chat and Scribe
 * web. IdP sign-out ends them, even when a back-channel logout is lost.
 */
const SESSION_BOUND_STATIC_CLIENTS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
	STATIC_CLIENT_IDS.chatWeb,
	STATIC_CLIENT_IDS.scribeWeb,
	STATIC_CLIENT_IDS.scribeWebDev,
]);

export function refreshesWithSession(clientId: string): boolean {
	return (
		!isStaticClientId(clientId) || SESSION_BOUND_STATIC_CLIENTS.has(clientId)
	);
}

/**
 * First-party native apps whose grant belongs to the device rather than to
 * the IdP browser session: refresh tokens without offline_access, kept on
 * IdP sign-out, sliding without the 90-day cap except `CAPPED_DEVICE_CLIENTS`
 * (sliding-grants.ts); each device stays revocable at /account.
 */
const DEVICE_BOUND_STATIC_CLIENTS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.chatMobile,
	STATIC_CLIENT_IDS.scribeMobile,
	STATIC_CLIENT_IDS.accountIos,
]);

export function refreshesPerDevice(clientId: string | undefined): boolean {
	return clientId !== undefined && DEVICE_BOUND_STATIC_CLIENTS.has(clientId);
}

/** Static clients that never use an API access token, so list no resource. */
export const CLIENTS_WITHOUT_RESOURCES: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.accountPortal,
	...Object.values(CHAT_CLIENT_IDS),
	...Object.values(SCRIBE_CLIENT_IDS),
	...Object.values(MIU_CLIENT_IDS),
	...Object.values(ACCOUNT_IOS_CLIENT_IDS),
	...Object.values(SIGN_IN_ONLY_CLIENT_IDS),
]);

function scopeOf(...groups: readonly (readonly string[])[]): string {
	return groups.flat().join(" ");
}

function appUrl(base: string, path: string): string {
	return new URL(path, base).href;
}

/**
 * The first-party clients of the tenant: origins, resources, names and
 * secrets the tenant's. Scribe's, Miu World's, Tiểu Đệ's, Tử Vi's, Clip's
 * and the iOS account app's exist only when configured, on the primary
 * tenant only.
 */
export function buildStaticClients(
	tenant: Pick<Tenant, "id" | "issuer" | "displayName" | "webApps">,
	resources: TenantResources,
	secrets: StaticClientSecrets,
	chatMobileRedirectUri: string,
	scribe?: PrimaryAppClientsConfig,
	miu?: PrimaryAppClientsConfig,
	signInOnlyApps: SignInOnlyApps = {},
): ClientMetadata[] {
	const localman = tenant.webApps.localman;
	const tunelo = tenant.webApps.tunelo;
	return [
		{
			client_id: STATIC_CLIENT_IDS.localmanWeb,
			client_name: "Localman",
			client_secret: secrets.localmanWeb,
			token_endpoint_auth_method: "client_secret_basic",
			// Token exchange: a short tunnels:read token for Tunelo's API.
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
			[ALLOWED_RESOURCES_PROPERTY]: [resources.localman],
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
			[ALLOWED_RESOURCES_PROPERTY]: [resources.tunnel],
		},
		{
			client_id: STATIC_CLIENT_IDS.tuneloWeb,
			client_name: "Tunelo",
			client_secret: secrets.tuneloWeb,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [appUrl(tunelo, "/auth/callback")],
			post_logout_redirect_uris: [appUrl(tunelo, "/")],
			backchannel_logout_uri: appUrl(tunelo, "/auth/backchannel-logout"),
			backchannel_logout_session_required: true,
			// No offline_access: its refresh tokens live with the IdP session.
			scope: scopeOf(["openid", "profile", "email"], TUNNEL_SCOPES),
			[ALLOWED_RESOURCES_PROPERTY]: [resources.tunnel],
		},
		{
			// Public client with PKCE: /account signs in through the usual
			// login pages; then only the IdP session cookie matters.
			client_id: STATIC_CLIENT_IDS.accountPortal,
			client_name: `Tài khoản ${tenant.displayName}`,
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			redirect_uris: [appUrl(tenant.issuer, ACCOUNT_PORTAL_CALLBACK_PATH)],
			scope: "openid",
			[ALLOWED_RESOURCES_PROPERTY]: [],
		},
		...buildChatClients(
			tenant.webApps.chat,
			secrets.chatWeb,
			chatMobileRedirectUri,
		),
		...buildScribeClients(tenant, scribe),
		...buildMiuClients(tenant, miu),
		...buildAccountIosClients(tenant),
		...buildSignInOnlyClients(tenant, signInOnlyApps),
	];
}
