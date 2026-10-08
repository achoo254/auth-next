import { z } from "zod";
import {
	checkIntegrationGroups,
	integrationEnvShape,
} from "./integrations-env.js";
import { type TrustProxy, parseTrustProxy } from "./trust-proxy.js";

const port = z.coerce.number().int().min(1).max(65_535);

/** A secret long enough to resist offline guessing; its value is never echoed. */
const secret = z
	.string({ error: "is required" })
	.min(32, "must be at least 32 characters");

const httpUrl = z.url({
	protocol: /^https?$/,
	error: "must be an http(s) URL",
});

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** https on a hostname other clients can reach (not loopback). */
function isPublicHttpsUrl(value: string): boolean {
	const url = URL.parse(value);
	if (!url || url.protocol !== "https:") return false;
	const hostname = url.hostname.toLowerCase();
	return !LOCAL_HOSTNAMES.has(hostname) && !hostname.endsWith(".localhost");
}

const HOST_PATTERN = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d{1,5})?$/;

const PRODUCTION_URLS = [
	"ISSUER",
	"LOCALMAN_WEB_URL",
	"TUNELO_WEB_URL",
] as const;

const envSchema = z
	.object({
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		HOST: z.string().min(1).default("127.0.0.1"),
		PORT: port.default(4500),
		ISSUER: httpUrl
			.refine((value) => !value.endsWith("/"), "must not end with a slash")
			.default("http://localhost:4500"),
		MONGO_URL: z
			.string({ error: "is required" })
			.regex(
				/^mongodb(\+srv)?:\/\/[^/\s]+\/[^/?\s]+(\?\S*)?$/,
				"must be a mongodb:// URI that names a database",
			),
		SIGNING_KEYS_PATH: z.string({ error: "is required" }).min(1),
		COOKIE_KEYS: z
			.string({ error: "is required" })
			.transform((value) => value.split(",").map((key) => key.trim()))
			.pipe(
				z
					.array(secret)
					.min(1, "must list at least one key; the first one signs"),
			),
		LOCALMAN_WEB_URL: httpUrl.default("https://localman.hoandat.com"),
		LOCALMAN_WEB_CLIENT_SECRET: secret,
		TUNELO_WEB_URL: httpUrl.default("https://tunnel.hoandat.com"),
		TUNELO_WEB_CLIENT_SECRET: secret,
		TRUST_PROXY: z
			.string()
			.default("loopback")
			.transform((value, ctx): TrustProxy => {
				try {
					return parseTrustProxy(value);
				} catch (error) {
					ctx.addIssue({
						code: "custom",
						message: error instanceof Error ? error.message : "is invalid",
					});
					return z.NEVER;
				}
			}),
		/** Extra Host values served besides the issuer's (e.g. 127.0.0.1:4500). */
		ALLOWED_HOSTS: z
			.string()
			.default("")
			.transform((value) =>
				value
					.split(",")
					.map((host) => host.trim().toLowerCase())
					.filter((host) => host.length > 0),
			)
			.pipe(
				z.array(
					z.string().regex(HOST_PATTERN, "must list host or host:port values"),
				),
			),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
			.default("info"),
		...integrationEnvShape,
	})
	.superRefine((env, ctx) => {
		checkIntegrationGroups(env, ctx);
		if (env.NODE_ENV !== "production") return;
		for (const key of PRODUCTION_URLS) {
			if (!isPublicHttpsUrl(env[key])) {
				ctx.addIssue({
					code: "custom",
					path: [key],
					message: "must be an explicit public https URL in production",
				});
			}
		}
		const proxies = env.TRUST_PROXY;
		if (
			proxies === false ||
			(proxies.length === 1 && proxies[0] === "loopback")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["TRUST_PROXY"],
				message:
					"must name the reverse proxy address (and cloudflare) in production",
			});
		}
	});

export type Env = z.output<typeof envSchema>;

export class EnvError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EnvError";
	}
}

/**
 * Validates configuration from the environment. Empty values count as unset
 * so `KEY=` in a .env file falls back to the default. Error messages name the
 * variable but never echo its value, which may be a secret.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
	const defined = Object.fromEntries(
		Object.entries(source).filter(([, value]) => value !== ""),
	);
	const result = envSchema.safeParse(defined);
	if (result.success) return result.data;
	const lines = result.error.issues.map(
		(issue) => `  - ${issue.path.join(".") || "(env)"}: ${issue.message}`,
	);
	throw new EnvError(`Invalid environment configuration:\n${lines.join("\n")}`);
}
