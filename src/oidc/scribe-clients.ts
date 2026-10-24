import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import {
	type PrimaryAppClientsConfig,
	type PrimaryAppSpec,
	type PrimaryWebApp,
	buildPrimaryAppClients,
	webClient,
} from "./primary-app-clients.js";

/**
 * Clients of the Scribe app (repo scribe-next): web, mobile and an optional
 * web client for local development on the primary tenant; the web client
 * alone on a registry tenant that turned Scribe on (ADR 0012).
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

const SCRIBE_SPEC: PrimaryAppSpec = {
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
};

/**
 * The Scribe clients of `tenant`. Scribe runs its own sessions and only
 * reads the ID token and userinfo; its refresh tokens (no offline_access)
 * live with the IdP session on the web and with the device on mobile
 * (`refreshesPerDevice`). The primary tenant's come from `config`. A
 * registry tenant has exactly `scribe-web` (back-channel logout, secret
 * derived like chat-web's) once its `webApps.scribe` is set, and never the
 * mobile or development client.
 */
export function buildScribeClients(
	tenant: Pick<Tenant, "id"> & {
		readonly webApps?: Pick<Tenant["webApps"], "scribe">;
	},
	config: ScribeClientsConfig | undefined,
	registrySecret?: string,
): ClientMetadata[] {
	if (tenant.id === PRIMARY_TENANT_ID) {
		return buildPrimaryAppClients(SCRIBE_SPEC, tenant, config);
	}
	const url = tenant.webApps?.scribe;
	if (!url || !registrySecret) return [];
	return [
		webClient(
			SCRIBE_SPEC,
			SCRIBE_CLIENT_IDS.scribeWeb,
			{ url, secret: registrySecret },
			true,
		),
	];
}
