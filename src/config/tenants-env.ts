import { z } from "zod";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Settings for serving tenants beyond the primary one (ADR 0006). Without
 * TENANT_SECRETS_KEY and APP_CLIENT_SECRET_KEY the IdP serves the primary
 * tenant only, exactly as before.
 */
export const tenantsEnvShape = {
	/** `kid:base64key[,...]`, 32-byte keys; the first seals tenant secrets. */
	TENANT_SECRETS_KEY: z.string().min(1).optional(),
	/** Derives Localman/Tunelo client secrets per tenant (shared with them). */
	APP_CLIENT_SECRET_KEY: z
		.string()
		.min(32, "must be at least 32 characters")
		.optional(),
	/** Registry tenants served at once at most (claimed or active). */
	TENANT_MAX_ACTIVE: z.coerce.number().int().min(0).max(1000).default(20),
	/** The internal API listens here only; never behind nginx. */
	INTERNAL_HOST: z
		.string()
		.default("127.0.0.1")
		.refine((value) => LOOPBACK.has(value), "must be a loopback address"),
	INTERNAL_PORT: z.coerce.number().int().min(1).max(65_535).default(4501),
	/** `role:secret[,...]` for localman, tunelo, provisioner. */
	INTERNAL_API_CREDENTIALS: z.string().optional(),
	/** This service's public IPv4: tenant DNS must point exactly here. */
	SERVICE_IPV4: z.ipv4().optional(),
};

export function checkTenantsGroup(
	env: {
		readonly TENANT_SECRETS_KEY?: string;
		readonly APP_CLIENT_SECRET_KEY?: string;
	},
	ctx: z.RefinementCtx,
): void {
	const set = [env.TENANT_SECRETS_KEY, env.APP_CLIENT_SECRET_KEY].filter(
		(value) => value !== undefined,
	);
	if (set.length === 1) {
		ctx.addIssue({
			code: "custom",
			path: [
				env.TENANT_SECRETS_KEY ? "APP_CLIENT_SECRET_KEY" : "TENANT_SECRETS_KEY",
			],
			message:
				"must be set together with TENANT_SECRETS_KEY and APP_CLIENT_SECRET_KEY",
		});
	}
}
