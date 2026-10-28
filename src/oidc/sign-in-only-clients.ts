import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import type { PrimaryWebApp } from "./primary-app-clients.js";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/**
 * Apps whose visitors sign in only to prove they have an account: Tiểu Đệ
 * (repo tieu-de-next), Tử Vi (tu-vi-next), Clip (clip-next) and Web Nhanh
 * (webnhanh-next). Each has
 * one confidential web client and no mobile or development client.
 */
export const SIGN_IN_ONLY_APPS = {
	tieude: { clientId: "tieude-web", name: "Tiểu Đệ" },
	tuvi: { clientId: "tuvi-web", name: "Tử Vi" },
	clip: { clientId: "clip-web", name: "Clip" },
	webnhanh: { clientId: "webnhanh-web", name: "Web Nhanh" },
} as const;

export type SignInOnlyAppKey = keyof typeof SIGN_IN_ONLY_APPS;

export const SIGN_IN_ONLY_CLIENT_IDS = {
	tieudeWeb: SIGN_IN_ONLY_APPS.tieude.clientId,
	tuviWeb: SIGN_IN_ONLY_APPS.tuvi.clientId,
	clipWeb: SIGN_IN_ONLY_APPS.clip.clientId,
	webnhanhWeb: SIGN_IN_ONLY_APPS.webnhanh.clientId,
} as const;

/** Where each app's server receives the authorization code. */
export const SIGN_IN_ONLY_CALLBACK_PATH = "/auth/callback";

/** The configured apps: origin and client secret, both from the environment. */
export type SignInOnlyApps = Readonly<
	Partial<Record<SignInOnlyAppKey, PrimaryWebApp>>
>;

/** Whether `clientId` is one of these apps' (each exists only when configured). */
export function isSignInOnlyClientId(clientId: string): boolean {
	return Object.values<string>(SIGN_IN_ONLY_CLIENT_IDS).includes(clientId);
}

function signInOnlyClient(
	key: SignInOnlyAppKey,
	app: PrimaryWebApp,
): ClientMetadata {
	const at = (path: string): string => new URL(path, app.url).href;
	return {
		client_id: SIGN_IN_ONLY_APPS[key].clientId,
		client_name: SIGN_IN_ONLY_APPS[key].name,
		client_secret: app.secret,
		token_endpoint_auth_method: "client_secret_basic",
		grant_types: ["authorization_code"],
		response_types: ["code"],
		redirect_uris: [at(SIGN_IN_ONLY_CALLBACK_PATH)],
		post_logout_redirect_uris: [at("/")],
		scope: "openid",
		[ALLOWED_RESOURCES_PROPERTY]: [],
	};
}

/**
 * The clients of the configured apps of `tenant`: primary tenant only. Each
 * app keeps its own cookie and needs nothing but the account's `sub`: scope
 * `openid`, Code + PKCE (required for every client), no refresh token, no
 * API resource and no back-channel logout.
 */
export function buildSignInOnlyClients(
	tenant: Pick<Tenant, "id">,
	apps: SignInOnlyApps,
): ClientMetadata[] {
	if (tenant.id !== PRIMARY_TENANT_ID) return [];
	const keys = Object.keys(SIGN_IN_ONLY_APPS) as SignInOnlyAppKey[];
	return keys.flatMap((key) => {
		const app = apps[key];
		return app ? [signInOnlyClient(key, app)] : [];
	});
}
