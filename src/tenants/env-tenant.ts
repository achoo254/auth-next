import type { Env } from "../config/env.js";
import type { StaticClientSecrets } from "../oidc/clients.js";
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
 * `LOCALMAN_WEB_URL` and `TUNELO_WEB_URL`. It is always active and owns the
 * documents written before tenants existed.
 */
export function envTenant(
	env: Pick<
		Env,
		| "ISSUER"
		| "TENANT_DOMAIN"
		| "TENANT_DISPLAY_NAME"
		| "LOCALMAN_WEB_URL"
		| "TUNELO_WEB_URL"
	>,
): Tenant {
	return {
		id: PRIMARY_TENANT_ID,
		domain: env.TENANT_DOMAIN,
		displayName: env.TENANT_DISPLAY_NAME,
		issuer: env.ISSUER,
		status: "active",
		webApps: { localman: env.LOCALMAN_WEB_URL, tunelo: env.TUNELO_WEB_URL },
		ownsUntaggedData: true,
	};
}

/** The primary tenant's first-party client secrets, from the environment. */
export function envClientSecrets(
	env: Pick<Env, "LOCALMAN_WEB_CLIENT_SECRET" | "TUNELO_WEB_CLIENT_SECRET">,
): StaticClientSecrets {
	return {
		localmanWeb: env.LOCALMAN_WEB_CLIENT_SECRET,
		tuneloWeb: env.TUNELO_WEB_CLIENT_SECRET,
	};
}
