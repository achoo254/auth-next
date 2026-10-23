import type { ClientMetadata } from "oidc-provider";
import type { Tenant } from "../tenants/tenant.js";
import {
	type PrimaryAppClientsConfig,
	buildPrimaryAppClients,
} from "./primary-app-clients.js";

/**
 * Clients of Miu World (repo miu-world-next): web, the iPhone/Android app
 * and an optional web client for local development. Miu World is served
 * for the primary tenant only, so these clients exist nowhere else.
 */
export const MIU_CLIENT_IDS = {
	miuWeb: "miu-web",
	miuMobile: "miu-mobile",
	miuWebDev: "miu-web-dev",
} as const;

/**
 * Default private-use URI scheme redirect of the Miu World app (RFC 8252
 * §7.1); `MIU_MOBILE_REDIRECT_URI` overrides it.
 */
export const MIU_MOBILE_REDIRECT_URI = "com.hoandat.miu:/auth/callback";

/** Where Miu World's server receives the code and back-channel logout. */
export const MIU_CALLBACK_PATH = "/api/auth/callback";
export const MIU_BACKCHANNEL_LOGOUT_PATH = "/api/auth/backchannel-logout";

/** What the primary tenant's environment configures for Miu World. */
export type MiuClientsConfig = PrimaryAppClientsConfig;

/** Whether `clientId` is one of Miu World's (they exist only when configured). */
export function isMiuClientId(clientId: string): boolean {
	return Object.values<string>(MIU_CLIENT_IDS).includes(clientId);
}

/**
 * The Miu World clients of `tenant` (primary tenant only). Miu keeps its
 * own sessions and only needs the parent's verified email: scope
 * `openid email`, and no refresh token at all (authorization code only),
 * so its grants never outlive the sign-in that made them.
 */
export function buildMiuClients(
	tenant: Pick<Tenant, "id">,
	config: MiuClientsConfig | undefined,
): ClientMetadata[] {
	return buildPrimaryAppClients(
		{
			ids: {
				web: MIU_CLIENT_IDS.miuWeb,
				mobile: MIU_CLIENT_IDS.miuMobile,
				webDev: MIU_CLIENT_IDS.miuWebDev,
			},
			name: "Miu World",
			scope: "openid email",
			grantTypes: ["authorization_code"],
			callbackPath: MIU_CALLBACK_PATH,
			backchannelLogoutPath: MIU_BACKCHANNEL_LOGOUT_PATH,
		},
		tenant,
		config,
	);
}
