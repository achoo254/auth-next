import type { Env } from "../config/env.js";
import type { StaticClientSecrets } from "../oidc/clients.js";
import type { PrimaryAppClientsConfig } from "../oidc/primary-app-clients.js";
import type { SignInOnlyApps } from "../oidc/sign-in-only-clients.js";
import type { Tenant } from "./tenant.js";

/**
 * Id of the tenant configured by the environment (hoandat.com in
 * production). Fixed, so its data stays its own whatever the domain says.
 */
export const PRIMARY_TENANT_ID = "primary";

/**
 * The primary tenant, from the environment: its issuer is `ISSUER` as
 * before (any shape, so the conformance harness keeps working), its domain
 * `TENANT_DOMAIN` (resources and audiences follow from it), its web apps
 * `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL`, `CHAT_WEB_URL` and, once their client
 * secrets are set, `SCRIBE_WEB_URL`, `MIU_WEB_URL`, `TIEUDE_WEB_URL`,
 * `TUVI_WEB_URL`, `CLIP_WEB_URL` and `TRANG_WEB_URL`.
 */
export function envTenant(
	env: Pick<
		Env,
		| "ISSUER"
		| "TENANT_DOMAIN"
		| "TENANT_DISPLAY_NAME"
		| "LOCALMAN_WEB_URL"
		| "TUNELO_WEB_URL"
		| "CHAT_WEB_URL"
		| "SCRIBE_WEB_URL"
		| "SCRIBE_WEB_CLIENT_SECRET"
		| "MIU_WEB_URL"
		| "MIU_WEB_CLIENT_SECRET"
		| "TIEUDE_WEB_URL"
		| "TIEUDE_WEB_CLIENT_SECRET"
		| "TUVI_WEB_URL"
		| "TUVI_WEB_CLIENT_SECRET"
		| "CLIP_WEB_URL"
		| "CLIP_WEB_CLIENT_SECRET"
		| "TRANG_WEB_URL"
		| "TRANG_WEB_CLIENT_SECRET"
	>,
): Tenant {
	return {
		id: PRIMARY_TENANT_ID,
		domain: env.TENANT_DOMAIN,
		displayName: env.TENANT_DISPLAY_NAME,
		issuer: env.ISSUER,
		webApps: {
			localman: env.LOCALMAN_WEB_URL,
			tunelo: env.TUNELO_WEB_URL,
			chat: env.CHAT_WEB_URL,
			...(env.SCRIBE_WEB_CLIENT_SECRET ? { scribe: env.SCRIBE_WEB_URL } : {}),
			...(env.MIU_WEB_CLIENT_SECRET ? { miu: env.MIU_WEB_URL } : {}),
			...signInOnlyOrigins(envSignInOnlyApps(env)),
		},
	};
}

/** The primary tenant's first-party client secrets, from the environment. */
export function envClientSecrets(
	env: Pick<
		Env,
		| "LOCALMAN_WEB_CLIENT_SECRET"
		| "TUNELO_WEB_CLIENT_SECRET"
		| "CHAT_WEB_CLIENT_SECRET"
	>,
): StaticClientSecrets {
	return {
		localmanWeb: env.LOCALMAN_WEB_CLIENT_SECRET,
		tuneloWeb: env.TUNELO_WEB_CLIENT_SECRET,
		chatWeb: env.CHAT_WEB_CLIENT_SECRET,
	};
}

/** One primary-tenant app's clients from its web, mobile and dev settings. */
function appClients(
	url: string,
	secret: string | undefined,
	mobileRedirectUri: string,
	devUrl: string | undefined,
	devSecret: string | undefined,
): PrimaryAppClientsConfig {
	return {
		...(secret ? { web: { url, secret } } : {}),
		mobileRedirectUri,
		...(devUrl && devSecret ? { dev: { url: devUrl, secret: devSecret } } : {}),
	};
}

/** The primary tenant's Scribe clients, from the environment. */
export function envScribeClients(
	env: Pick<
		Env,
		| "SCRIBE_WEB_URL"
		| "SCRIBE_WEB_CLIENT_SECRET"
		| "SCRIBE_MOBILE_REDIRECT_URI"
		| "SCRIBE_WEB_DEV_URL"
		| "SCRIBE_WEB_DEV_CLIENT_SECRET"
	>,
): PrimaryAppClientsConfig {
	return appClients(
		env.SCRIBE_WEB_URL,
		env.SCRIBE_WEB_CLIENT_SECRET,
		env.SCRIBE_MOBILE_REDIRECT_URI,
		env.SCRIBE_WEB_DEV_URL,
		env.SCRIBE_WEB_DEV_CLIENT_SECRET,
	);
}

/**
 * The primary tenant's Tiểu Đệ, Tử Vi, Clip and Trang Của Tôi clients, from the
 * environment: an app is left out unless both its origin and its secret
 * are set (parseEnv rejects one alone).
 */
export function envSignInOnlyApps(
	env: Pick<
		Env,
		| "TIEUDE_WEB_URL"
		| "TIEUDE_WEB_CLIENT_SECRET"
		| "TUVI_WEB_URL"
		| "TUVI_WEB_CLIENT_SECRET"
		| "CLIP_WEB_URL"
		| "CLIP_WEB_CLIENT_SECRET"
		| "TRANG_WEB_URL"
		| "TRANG_WEB_CLIENT_SECRET"
	>,
): SignInOnlyApps {
	const app = (url?: string, secret?: string) =>
		url && secret ? { url, secret } : undefined;
	const apps = {
		tieude: app(env.TIEUDE_WEB_URL, env.TIEUDE_WEB_CLIENT_SECRET),
		tuvi: app(env.TUVI_WEB_URL, env.TUVI_WEB_CLIENT_SECRET),
		clip: app(env.CLIP_WEB_URL, env.CLIP_WEB_CLIENT_SECRET),
		trang: app(env.TRANG_WEB_URL, env.TRANG_WEB_CLIENT_SECRET),
	};
	return Object.fromEntries(
		Object.entries(apps).filter(([, value]) => value !== undefined),
	);
}

/** The origins of the configured apps, for `Tenant.webApps`. */
function signInOnlyOrigins(
	apps: SignInOnlyApps,
): Pick<Tenant["webApps"], "tieude" | "tuvi" | "clip" | "trang"> {
	return Object.fromEntries(
		Object.entries(apps).map(([key, app]) => [key, app.url]),
	);
}

/** The primary tenant's Miu World clients, from the environment. */
export function envMiuClients(
	env: Pick<
		Env,
		| "MIU_WEB_URL"
		| "MIU_WEB_CLIENT_SECRET"
		| "MIU_MOBILE_REDIRECT_URI"
		| "MIU_WEB_DEV_URL"
		| "MIU_WEB_DEV_CLIENT_SECRET"
	>,
): PrimaryAppClientsConfig {
	return appClients(
		env.MIU_WEB_URL,
		env.MIU_WEB_CLIENT_SECRET,
		env.MIU_MOBILE_REDIRECT_URI,
		env.MIU_WEB_DEV_URL,
		env.MIU_WEB_DEV_CLIENT_SECRET,
	);
}
