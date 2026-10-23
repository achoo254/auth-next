import type { ClientMetadata } from "oidc-provider";
import type { Tenant } from "../tenants/tenant.js";
import {
	type PrimaryAppClientsConfig,
	type PrimaryWebApp,
	buildPrimaryAppClients,
} from "./primary-app-clients.js";

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

/** A Scribe web deployment: its origin and its client secret. */
export type ScribeWebApp = PrimaryWebApp;

/**
 * What the primary tenant's environment configures for Scribe. `web`
 * enables scribe-web and scribe-mobile; `dev` enables scribe-web-dev, whose
 * redirect points at a developer's own machine (loopback).
 */
export type ScribeClientsConfig = PrimaryAppClientsConfig;

/** Whether `clientId` is one of Scribe's (they exist only when configured). */
export function isScribeClientId(clientId: string): boolean {
	return Object.values<string>(SCRIBE_CLIENT_IDS).includes(clientId);
}

/**
 * The Scribe clients of `tenant` (primary tenant only). Scribe runs its own
 * sessions and only reads the ID token and userinfo; its refresh tokens
 * (no offline_access) live with the IdP session on the web and with the
 * device on mobile (`refreshesPerDevice`).
 */
export function buildScribeClients(
	tenant: Pick<Tenant, "id">,
	config: ScribeClientsConfig | undefined,
): ClientMetadata[] {
	return buildPrimaryAppClients(
		{
			ids: {
				web: SCRIBE_CLIENT_IDS.scribeWeb,
				mobile: SCRIBE_CLIENT_IDS.scribeMobile,
				webDev: SCRIBE_CLIENT_IDS.scribeWebDev,
			},
			name: "Scribe",
			scope: "openid profile email",
			grantTypes: ["authorization_code", "refresh_token"],
			callbackPath: SCRIBE_CALLBACK_PATH,
			backchannelLogoutPath: SCRIBE_BACKCHANNEL_LOGOUT_PATH,
		},
		tenant,
		config,
	);
}
