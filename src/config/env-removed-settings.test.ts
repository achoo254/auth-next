import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const REQUIRED = {
	MONGO_URL: "mongodb://mongo:27017/auth?replicaSet=rs0",
	SIGNING_KEYS_PATH: "/run/secrets/signing-keys.json",
	COOKIE_KEYS: "a".repeat(32),
	LOCALMAN_WEB_CLIENT_SECRET: "b".repeat(32),
	TUNELO_WEB_CLIENT_SECRET: "c".repeat(32),
	CHAT_WEB_CLIENT_SECRET: "d".repeat(32),
};

/**
 * Settings of domain tenants, self-hosting and Scribe on tenants, gone
 * with them. Production's .env may still hold them for a while after the
 * release that removed them, even with values the old checks refused.
 */
const REMOVED_SETTINGS = {
	SELF_HOSTED_CLAIMS: "maybe",
	SCRIBE_TENANTS: "yes",
	SCRIBE_SEALING_PUBLIC_KEY_PATH: "/root/secrets/scribe-sealing.pub.pem",
	TENANT_SECRETS_KEY: "k1:not-base64",
	APP_CLIENT_SECRET_KEY: "short",
	TENANT_MAX_ACTIVE: "-1",
	PROVISIONER_PUBLIC_KEY_PATH: "/root/secrets/provisioner.pub.pem",
	CLAIM_BLOCKED_DOMAINS: "inetdev.io.vn",
	CLAIM_MIN_AVAILABLE_MB: "lots",
	ENROLLMENT_GATEWAY: "not a url",
	INTERNAL_API_CREDENTIALS: "localman:x",
	INTERNAL_HOST: "0.0.0.0",
	INTERNAL_PORT: "99999",
	SERVICE_IPV4: "not an ip",
};

describe("parseEnv after domain tenants were removed", () => {
	it("starts with the removed settings still in the environment, and drops them", () => {
		const env = parseEnv({ ...REQUIRED, ...REMOVED_SETTINGS });
		expect(env.ISSUER).toBe("http://localhost:4500");
		for (const name of Object.keys(REMOVED_SETTINGS)) {
			expect(env, name).not.toHaveProperty(name);
		}
	});
});
