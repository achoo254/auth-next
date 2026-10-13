import type { Configuration } from "oidc-provider";
import {
	deviceSuccessSource,
	userCodeConfirmSource,
	userCodeInputSource,
} from "../interactions/device-verify-page.js";
import {
	logoutSource,
	postLogoutSuccessSource,
} from "../interactions/logout-page.js";
import { TRUSTED_INTROSPECTION_CLIENT_IDS } from "./clients.js";
import type { ResourcePolicy } from "./resources.js";

/** The oidc-provider features of one tenant; resources are the tenant's own. */
export function buildProviderFeatures(
	resources: ResourcePolicy,
): NonNullable<Configuration["features"]> {
	return {
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
			defaultResource: resources.defaultResource,
			getResourceServerInfo: resources.getResourceServerInfo,
			useGrantedResource: async () => true,
		},
	};
}
