import { z } from "zod";
import { looksLikeAppHost, normalizeTenantDomain } from "../tenants/tenant.js";

const domainList = z
	.string()
	.default("")
	.transform((value) =>
		value
			.split(",")
			.map((domain) => domain.trim())
			.filter((domain) => domain.length > 0),
	);

/**
 * The provisioner's settings, from its own root-only env file. It never
 * reads the IdP's .env: it holds only its internal API credentials and its
 * private key, the one that opens DNS tokens.
 */
const schema = z.object({
	/** The IdP's internal API (loopback). */
	PROVISIONER_INTERNAL_URL: z.url().default("http://127.0.0.1:4501"),
	PROVISIONER_INTERNAL_SECRET: z.string().min(32),
	PROVISIONER_PRIVATE_KEY_PATH: z.string().min(1),
	/** Root-only: the Cloudflare credentials files (never readable by nginx). */
	PROVISIONER_SECRETS_DIR: z
		.string()
		.min(1)
		.default("/etc/hoandat-tenant-provisioner/credentials"),
	/** Group nginx workers run as: certificates are made readable to it. */
	PROVISIONER_NGINX_GROUP: z
		.string()
		.regex(/^[a-z_][a-z0-9_-]*$/)
		.default("nginx"),
	/** The nginx configuration read (with its includes) to spot name clashes. */
	PROVISIONER_NGINX_CONF: z.string().min(1).default("/etc/nginx/nginx.conf"),
	/** Separate from /etc/letsencrypt: own ACME account, own renewals. */
	PROVISIONER_CONFIG_DIR: z.string().min(1).default("/etc/letsencrypt-tenants"),
	PROVISIONER_WEBROOT: z
		.string()
		.min(1)
		.default("/var/lib/hoandat-tenant-acme"),
	PROVISIONER_CERTBOT: z.string().min(1).default("/usr/local/bin/certbot"),
	/** "staging" uses Let's Encrypt staging (test runs). */
	PROVISIONER_ACME: z.enum(["production", "staging"]).default("staging"),
	/** The primary tenant's domain and every other domain on the machine. */
	PROVISIONER_BLOCKED_DOMAINS: domainList,
});

export type ProvisionerConfig = z.output<typeof schema>;

export function parseProvisionerConfig(
	source: NodeJS.ProcessEnv,
): ProvisionerConfig {
	const defined = Object.fromEntries(
		Object.entries(source).filter(([, value]) => value !== ""),
	);
	const result = schema.safeParse(defined);
	if (result.success) return result.data;
	const names = result.error.issues.map((issue) => issue.path.join("."));
	throw new Error(`Invalid provisioner configuration: ${names.join(", ")}`);
}

/**
 * The domain of a work item, checked again here: the IdP normalised it,
 * but certbot and file paths are built from it as root, so the provisioner
 * trusts nothing it did not check itself.
 */
export function checkedDomain(
	value: unknown,
	config: Pick<ProvisionerConfig, "PROVISIONER_BLOCKED_DOMAINS">,
): string | undefined {
	if (typeof value !== "string") return undefined;
	const domain = normalizeTenantDomain(
		value,
		config.PROVISIONER_BLOCKED_DOMAINS,
	);
	// Only an already canonical value passes: no case, port or dot rewriting.
	if (domain !== value || looksLikeAppHost(domain)) return undefined;
	return domain;
}
