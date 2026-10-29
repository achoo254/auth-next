import type { ClientMetadata } from "oidc-provider";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import type { Tenant } from "../tenants/tenant.js";
import type { PrimaryWebApp } from "./primary-app-clients.js";
import { ALLOWED_RESOURCES_PROPERTY } from "./resources.js";

/** Only the account's `sub`: Tiểu Đệ shows no account in its header. */
const SUB_ONLY_SCOPE = "openid";
/** Name, picture and email too, for the account menu in the app's header. */
const PROFILE_SCOPE = "openid profile email";

/**
 * Apps whose visitors sign in only to prove they have an account: Tiểu Đệ
 * (repo tieu-de-next), Tử Vi (tu-vi-next), Clip (clip-next) and Web Nhanh
 * (webnhanh-next). Each has one confidential web client and no mobile or
 * development client. Tử Vi, Clip and Web Nhanh also read the name,
 * picture and email (userinfo) to show the signed-in account in their
 * header; Tiểu Đệ needs nothing but `sub`.
 */
export const SIGN_IN_ONLY_APPS = {
	tieude: { clientId: "tieude-web", name: "Tiểu Đệ", scope: SUB_ONLY_SCOPE },
	tuvi: { clientId: "tuvi-web", name: "Tử Vi", scope: PROFILE_SCOPE },
	clip: { clientId: "clip-web", name: "Clip", scope: PROFILE_SCOPE },
	webnhanh: {
		clientId: "webnhanh-web",
		name: "Web Nhanh",
		scope: PROFILE_SCOPE,
	},
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
		scope: SIGN_IN_ONLY_APPS[key].scope,
		[ALLOWED_RESOURCES_PROPERTY]: [],
	};
}

/**
 * The clients of the configured apps of `tenant`: primary tenant only. Each
 * app keeps its own cookie: its scope (`SIGN_IN_ONLY_APPS`), Code + PKCE
 * (required for every client), no refresh token, no API resource and no
 * back-channel logout. First-party web clients consent silently, so the
 * wider scope shows no consent page (interactions/consent-handler.ts).
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
