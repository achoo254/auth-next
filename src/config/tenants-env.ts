import { z } from "zod";

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * A self-hosted install waiting to enroll at its gateway (ADR 0007): the
 * gateway's issuer, the bundle the owner downloaded from its /claim, and
 * where the install keeps the key it enrolls with (created when missing).
 */
const enrollmentEnvShape = {
	ENROLLMENT_GATEWAY: z
		.url({ protocol: /^https?$/, error: "must be an http(s) URL" })
		.transform((value) => value.replace(/\/+$/, ""))
		.optional(),
	ENROLLMENT_BUNDLE_PATH: z.string().min(1).optional(),
	ENROLLMENT_KEY_PATH: z.string().min(1).optional(),
};

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
	/** `role:secret[,...]` for localman, tunelo, provisioner, scribe. */
	INTERNAL_API_CREDENTIALS: z.string().optional(),
	/** This service's public IPv4: tenant DNS must point exactly here. */
	SERVICE_IPV4: z.ipv4().optional(),
	/** PEM file of the provisioner's RSA public key (DNS tokens are sealed to it). */
	PROVISIONER_PUBLIC_KEY_PATH: z.string().min(1).optional(),
	/**
	 * Offers the self-hosted mode on /claim (ADR 0007): the domain proves
	 * ownership by TXT only and runs on the owner's own servers.
	 */
	SELF_HOSTED_CLAIMS: z
		.enum(["true", "false"], { error: "must be true or false" })
		.default("false")
		.transform((value) => value === "true"),
	/** No new claims while the machine has less memory available than this. */
	CLAIM_MIN_AVAILABLE_MB: z.coerce.number().int().min(0).default(300),
	/**
	 * Domains nobody may claim (with everything under them), besides the
	 * primary tenant's: every other domain served on this machine.
	 */
	CLAIM_BLOCKED_DOMAINS: z
		.string()
		.default("inetdev.io.vn")
		.transform((value) =>
			value
				.split(",")
				.map((domain) => domain.trim())
				.filter((domain) => domain.length > 0),
		),
	...enrollmentEnvShape,
};

const ENROLLMENT_KEYS = [
	"ENROLLMENT_GATEWAY",
	"ENROLLMENT_BUNDLE_PATH",
	"ENROLLMENT_KEY_PATH",
] as const;

export function checkTenantsGroup(
	env: {
		readonly TENANT_SECRETS_KEY?: string;
		readonly APP_CLIENT_SECRET_KEY?: string;
	} & { readonly [K in (typeof ENROLLMENT_KEYS)[number]]?: string },
	ctx: z.RefinementCtx,
): void {
	const enrollment = ENROLLMENT_KEYS.filter((key) => env[key] !== undefined);
	if (enrollment.length > 0 && enrollment.length < ENROLLMENT_KEYS.length) {
		for (const key of ENROLLMENT_KEYS) {
			if (env[key] !== undefined) continue;
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: "must be set together with the other ENROLLMENT_* settings",
			});
		}
	}
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
