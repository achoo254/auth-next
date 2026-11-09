import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import {
	type PrimaryWebApp,
	type WebClientSpec,
	webClient,
} from "./primary-app-clients.js";

/**
 * Clients of Knowledge Base (repo kb-next, kb.hoandat.com): a web client used by
 * its server (BFF) and an optional web client for a developer's own machine.
 * Knowledge Base has no mobile app, and it is served for the primary tenant only.
 */
export const KB_CLIENT_IDS = {
	kbWeb: "kb-web",
	kbWebDev: "kb-web-dev",
} as const;

/** Where Knowledge Base's server receives the code and back-channel logout. */
export const KB_CALLBACK_PATH = "/auth/callback";
export const KB_BACKCHANNEL_LOGOUT_PATH = "/auth/backchannel-logout";

/**
 * What the primary tenant's environment configures for Knowledge Base: `web`
 * enables kb-web, `dev` enables kb-web-dev (loopback redirect).
 */
export interface KbClientsConfig {
	readonly web?: PrimaryWebApp;
	readonly dev?: PrimaryWebApp;
}

/**
 * Knowledge Base keeps its own session and reads the name, picture and email
 * (userinfo) for its account menu: no refresh token (authorization code
 * only), no API resource.
 */
const KB_SPEC: WebClientSpec = {
	name: "Knowledge Base",
	scope: "openid profile email",
	grantTypes: ["authorization_code"],
	callbackPath: KB_CALLBACK_PATH,
	backchannelLogoutPath: KB_BACKCHANNEL_LOGOUT_PATH,
};

/** Whether `clientId` is one of Knowledge Base's (they exist only when configured). */
export function isKbClientId(clientId: string): boolean {
	return Object.values<string>(KB_CLIENT_IDS).includes(clientId);
}

/**
 * The Knowledge Base clients of `tenant` that `config` enables, primary tenant
 * only: other tenants have no host for Knowledge Base and must never redirect to
 * the primary tenant's. kb-web has a back-channel logout; kb-web-dev has
 * none, as a developer's machine is unreachable from the IdP.
 */
export function buildKbClients(
	tenant: Pick<Tenant, "id">,
	config: KbClientsConfig | undefined,
): ClientMetadata[] {
	if (!config || tenant.id !== PRIMARY_TENANT_ID) return [];
	const clients: ClientMetadata[] = [];
	if (config.web) {
		clients.push(webClient(KB_SPEC, KB_CLIENT_IDS.kbWeb, config.web, true));
	}
	if (config.dev) {
		clients.push(webClient(KB_SPEC, KB_CLIENT_IDS.kbWebDev, config.dev, false));
	}
	return clients;
}
