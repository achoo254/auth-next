import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import type { PrimaryWebApp } from "./primary-app-clients.js";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/**
 * The web client of Tiểu Đệ (repo tieu-de-next). Visitors sign in only to
 * prove they have an account, so there is one confidential web client and
 * no mobile or development client.
 */
export const TIEUDE_CLIENT_IDS = {
	tieudeWeb: "tieude-web",
} as const;

/** Where Tiểu Đệ's server receives the authorization code. */
export const TIEUDE_CALLBACK_PATH = "/auth/callback";

/** Tiểu Đệ's origin and client secret, both from the environment. */
export type TieudeClientConfig = PrimaryWebApp;

/** Whether `clientId` is Tiểu Đệ's (it exists only when configured). */
export function isTieudeClientId(clientId: string): boolean {
	return Object.values<string>(TIEUDE_CLIENT_IDS).includes(clientId);
}

/**
 * The Tiểu Đệ client of `tenant`: primary tenant only, and only once
 * configured. Tiểu Đệ keeps its own cookie and needs nothing but the
 * account's `sub`: scope `openid`, Code + PKCE (required for every client),
 * no refresh token, no API resource and no back-channel logout.
 */
export function buildTieudeClients(
	tenant: Pick<Tenant, "id">,
	config: TieudeClientConfig | undefined,
): ClientMetadata[] {
	if (!config || tenant.id !== PRIMARY_TENANT_ID) return [];
	const at = (path: string): string => new URL(path, config.url).href;
	return [
		{
			client_id: TIEUDE_CLIENT_IDS.tieudeWeb,
			client_name: "Tiểu Đệ",
			client_secret: config.secret,
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			redirect_uris: [at(TIEUDE_CALLBACK_PATH)],
			post_logout_redirect_uris: [at("/")],
			scope: "openid",
			[ALLOWED_RESOURCES_PROPERTY]: [],
		},
	];
}
