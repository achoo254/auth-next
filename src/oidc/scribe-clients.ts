import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/**
 * Clients of the Scribe app (repo one-scribe): web, mobile and an optional
 * web client for local development. Scribe is served for the primary
 * tenant only, so these clients exist nowhere else.
 */
export const SCRIBE_CLIENT_IDS = {
	scribeWeb: "scribe-web",
	scribeMobile: "scribe-mobile",
	scribeWebDev: "scribe-web-dev",
} as const;

/**
 * Default private-use URI scheme redirect of the Scribe mobile app (RFC 8252
 * §7.1); `SCRIBE_MOBILE_REDIRECT_URI` overrides it.
 */
export const SCRIBE_MOBILE_REDIRECT_URI = "com.hoandat.scribe:/auth/callback";

/** Where Scribe's server receives the code and back-channel logout. */
export const SCRIBE_CALLBACK_PATH = "/api/auth/callback";
export const SCRIBE_BACKCHANNEL_LOGOUT_PATH = "/api/auth/backchannel-logout";

/** Scribe runs its own sessions and only reads the ID token and userinfo. */
const SCRIBE_SCOPE = "openid profile email";

/** A Scribe web deployment: its origin and its client secret. */
export interface ScribeWebApp {
	readonly url: string;
	readonly secret: string;
}

/**
 * What the primary tenant's environment configures for Scribe. `web`
 * enables scribe-web and scribe-mobile; `dev` enables scribe-web-dev, whose
 * redirect points at a developer's own machine (loopback).
 */
export interface ScribeClientsConfig {
	readonly web?: ScribeWebApp;
	readonly mobileRedirectUri: string;
	readonly dev?: ScribeWebApp;
}

/**
 * A confidential Scribe web client: Code + PKCE (oidc-provider requires
 * PKCE for every client here), refresh tokens bound to the IdP session.
 */
function webClient(
	clientId: string,
	app: ScribeWebApp,
	backchannel: boolean,
): ClientMetadata {
	const at = (path: string): string => new URL(path, app.url).href;
	return {
		client_id: clientId,
		client_name: "Scribe",
		client_secret: app.secret,
		token_endpoint_auth_method: "client_secret_basic",
		grant_types: ["authorization_code", "refresh_token"],
		response_types: ["code"],
		redirect_uris: [at(SCRIBE_CALLBACK_PATH)],
		post_logout_redirect_uris: [at("/")],
		...(backchannel
			? {
					backchannel_logout_uri: at(SCRIBE_BACKCHANNEL_LOGOUT_PATH),
					backchannel_logout_session_required: true,
				}
			: {}),
		// No offline_access: its refresh tokens live with the IdP session.
		scope: SCRIBE_SCOPE,
		[ALLOWED_RESOURCES_PROPERTY]: [],
	};
}

/** Whether `clientId` is one of Scribe's (they exist only when configured). */
export function isScribeClientId(clientId: string): boolean {
	return Object.values<string>(SCRIBE_CLIENT_IDS).includes(clientId);
}

/**
 * The Scribe clients of `tenant`: those `config` enables, for the primary
 * tenant only. Other tenants have no Scribe host and must never accept a
 * redirect to the primary tenant's Scribe, whatever is passed.
 */
export function buildScribeClients(
	tenant: Pick<Tenant, "id">,
	config: ScribeClientsConfig | undefined,
): ClientMetadata[] {
	if (!config || tenant.id !== PRIMARY_TENANT_ID) return [];
	const clients: ClientMetadata[] = [];
	if (config.web) {
		clients.push(webClient(SCRIBE_CLIENT_IDS.scribeWeb, config.web, true));
	}
	// The app's redirect is its own URL scheme, not a web origin: it also
	// exists with only the development client, so the app can be tried
	// against a developer's Scribe before the production site is live.
	if (config.web || config.dev) {
		clients.push({
			client_id: SCRIBE_CLIENT_IDS.scribeMobile,
			client_name: "Scribe",
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [config.mobileRedirectUri],
			scope: SCRIBE_SCOPE,
			[ALLOWED_RESOURCES_PROPERTY]: [],
		});
	}
	// Local development has no reachable back-channel endpoint.
	if (config.dev) {
		clients.push(webClient(SCRIBE_CLIENT_IDS.scribeWebDev, config.dev, false));
	}
	return clients;
}
