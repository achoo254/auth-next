import type { Env } from "../config/env.js";
import type { StaticClientSecrets } from "../oidc/clients.js";
import type { ScribeClientsConfig } from "../oidc/scribe-clients.js";
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
 * `LOCALMAN_WEB_URL`, `TUNELO_WEB_URL`, `CHAT_WEB_URL` and, once its client
 * secret is set, `SCRIBE_WEB_URL`. It is always active; documents written
 * before tenants existed are tagged as its own at startup.
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
	>,
): Tenant {
	return {
		id: PRIMARY_TENANT_ID,
		domain: env.TENANT_DOMAIN,
		displayName: env.TENANT_DISPLAY_NAME,
		issuer: env.ISSUER,
		status: "active",
		webApps: {
			localman: env.LOCALMAN_WEB_URL,
			tunelo: env.TUNELO_WEB_URL,
			chat: env.CHAT_WEB_URL,
			...(env.SCRIBE_WEB_CLIENT_SECRET ? { scribe: env.SCRIBE_WEB_URL } : {}),
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

/**
 * The primary tenant's Scribe clients, from the environment. Registry
 * tenants never get one (Scribe is not derived per tenant).
 */
export function envScribeClients(
	env: Pick<
		Env,
		| "SCRIBE_WEB_URL"
		| "SCRIBE_WEB_CLIENT_SECRET"
		| "SCRIBE_MOBILE_REDIRECT_URI"
		| "SCRIBE_WEB_DEV_URL"
		| "SCRIBE_WEB_DEV_CLIENT_SECRET"
	>,
): ScribeClientsConfig {
	const web = env.SCRIBE_WEB_CLIENT_SECRET;
	const devUrl = env.SCRIBE_WEB_DEV_URL;
	const devSecret = env.SCRIBE_WEB_DEV_CLIENT_SECRET;
	return {
		...(web ? { web: { url: env.SCRIBE_WEB_URL, secret: web } } : {}),
		mobileRedirectUri: env.SCRIBE_MOBILE_REDIRECT_URI,
		...(devUrl && devSecret ? { dev: { url: devUrl, secret: devSecret } } : {}),
	};
}
