import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import { ACCOUNT_SCOPE, ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/**
 * The iOS "Tài khoản" app (ios/ in this repo): a public native client that
 * signs in through the system browser and manages the account through
 * /api/account with its opaque access token. Primary tenant only (App
 * Store guideline 4.8: only the primary tenant offers Sign in with Apple).
 */
export const ACCOUNT_IOS_CLIENT_IDS = {
	accountIos: "account-ios",
} as const;

export const ACCOUNT_IOS_CLIENT_ID = ACCOUNT_IOS_CLIENT_IDS.accountIos;

/**
 * Universal links on the issuer (apple-app-site-association): the sign-in
 * callback, and where linking a provider from the app ends.
 */
export const IOS_CALLBACK_PATH = "/ios/callback";
export const IOS_LINKED_PATH = "/ios/linked";

/**
 * Device-bound clients whose grants still end 90 days after sign-in: an
 * app that manages the account signs in again at least that often.
 */
export const CAPPED_DEVICE_CLIENTS: ReadonlySet<string> = new Set([
	ACCOUNT_IOS_CLIENT_ID,
]);

/**
 * The client for `tenant`: present on the primary tenant only, whatever
 * the environment says, so no other tenant accepts a redirect to the app.
 */
export function buildAccountIosClients(
	tenant: Pick<Tenant, "id" | "issuer">,
): ClientMetadata[] {
	if (tenant.id !== PRIMARY_TENANT_ID) return [];
	const at = (path: string): string => new URL(path, tenant.issuer).href;
	return [
		{
			client_id: ACCOUNT_IOS_CLIENT_ID,
			client_name: "Tài khoản",
			application_type: "native",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			redirect_uris: [at(IOS_CALLBACK_PATH), at(IOS_LINKED_PATH)],
			// `auth_time` in every ID token: sensitive API calls present a
			// fresh one (recent-auth.ts).
			require_auth_time: true,
			scope: `openid profile email ${ACCOUNT_SCOPE}`,
			[ALLOWED_RESOURCES_PROPERTY]: [],
		},
	];
}
