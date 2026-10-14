import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "./env.js";
import { CLOUDFLARE_IP_RANGES } from "./trust-proxy.js";

const SECRET_A = "a".repeat(32);
const SECRET_B = "b".repeat(32);

const REQUIRED = {
	MONGO_URL: "mongodb://mongo:27017/auth?replicaSet=rs0",
	SIGNING_KEYS_PATH: "/run/secrets/signing-keys.json",
	COOKIE_KEYS: `${SECRET_A},${SECRET_B}`,
	LOCALMAN_WEB_CLIENT_SECRET: SECRET_A,
	TUNELO_WEB_CLIENT_SECRET: SECRET_B,
	CHAT_WEB_CLIENT_SECRET: "c".repeat(32),
};

describe("parseEnv", () => {
	it("applies defaults around the required values", () => {
		const env = parseEnv(REQUIRED);
		expect(env).toMatchObject({
			NODE_ENV: "development",
			HOST: "127.0.0.1",
			PORT: 4500,
			ISSUER: "http://localhost:4500",
			LOCALMAN_WEB_URL: "https://localman.hoandat.com",
			TUNELO_WEB_URL: "https://tunnel.hoandat.com",
			TRUST_PROXY: ["loopback"],
			ALLOWED_HOSTS: [],
			LOG_LEVEL: "info",
		});
		expect(env.COOKIE_KEYS).toEqual([SECRET_A, SECRET_B]);
	});

	it("names every missing variable", () => {
		expect(() => parseEnv({})).toThrow(EnvError);
		let message = "";
		try {
			parseEnv({});
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		for (const name of Object.keys(REQUIRED)) {
			expect(message).toContain(`${name}:`);
		}
	});

	it("rejects malformed values without echoing secrets", () => {
		let message = "";
		try {
			parseEnv({
				...REQUIRED,
				MONGO_URL: "mongodb://user:hunter2@mongo:27017",
				COOKIE_KEYS: "short-hunter3",
				LOCALMAN_WEB_CLIENT_SECRET: "hunter4",
				ISSUER: "ftp://auth.example.com",
				PORT: "99999",
			});
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		for (const name of [
			"MONGO_URL",
			"COOKIE_KEYS",
			"LOCALMAN_WEB_CLIENT_SECRET",
			"ISSUER",
			"PORT",
		]) {
			expect(message).toContain(`${name}`);
		}
		expect(message).not.toMatch(/hunter[234]/);
	});

	describe("production", () => {
		const PRODUCTION = {
			...REQUIRED,
			NODE_ENV: "production",
			ISSUER: "https://auth.hoandat.com",
			TRUST_PROXY: "172.18.0.1,cloudflare",
		};

		/** The validation message, or "" when the env is accepted. */
		function errorFor(overrides: Record<string, string | undefined>): string {
			try {
				parseEnv({ ...PRODUCTION, ...overrides });
				return "";
			} catch (error) {
				return error instanceof Error ? error.message : String(error);
			}
		}

		it("accepts an explicit https deployment", () => {
			expect(errorFor({})).toBe("");
		});

		it("requires an explicit https issuer that is not localhost", () => {
			expect(errorFor({ ISSUER: undefined })).toMatch(/ISSUER:/);
			expect(errorFor({ ISSUER: "http://auth.hoandat.com" })).toMatch(
				/ISSUER:/,
			);
			expect(errorFor({ ISSUER: "https://localhost:4500" })).toMatch(/ISSUER:/);
		});

		it("requires https app URLs that are not localhost", () => {
			expect(errorFor({ LOCALMAN_WEB_URL: "http://localhost:5173" })).toMatch(
				/LOCALMAN_WEB_URL:/,
			);
			expect(errorFor({ TUNELO_WEB_URL: "https://127.0.0.1" })).toMatch(
				/TUNELO_WEB_URL:/,
			);
		});

		it("requires the reverse proxy to be named explicitly", () => {
			expect(errorFor({ TRUST_PROXY: undefined })).toMatch(/TRUST_PROXY:/);
			expect(errorFor({ TRUST_PROXY: "loopback" })).toMatch(/TRUST_PROXY:/);
			expect(errorFor({ TRUST_PROXY: "false" })).toMatch(/TRUST_PROXY:/);
		});

		it("takes audit delivery all-or-nothing, over public https", () => {
			const audit = {
				AUDIT_EVENTS_URL: "https://localman.hoandat.com/internal/audit-events",
				AUDIT_CLIENT_ID: "hoandat-auth",
				AUDIT_CLIENT_SECRET: SECRET_A,
			};
			expect(errorFor(audit)).toBe("");
			const partial = errorFor({ ...audit, AUDIT_CLIENT_SECRET: undefined });
			expect(partial).toMatch(/AUDIT_CLIENT_SECRET: must be set together/);
			expect(partial).not.toContain(SECRET_A);
			expect(
				errorFor({ ...audit, AUDIT_EVENTS_URL: "http://localman:3000/x" }),
			).toMatch(/AUDIT_EVENTS_URL:/);
			// Credentials belong in the Basic header, never in the URL.
			const userinfo = errorFor({
				...audit,
				AUDIT_EVENTS_URL: "https://idp:pw@localman.hoandat.com/internal/x",
			});
			expect(userinfo).toMatch(
				/AUDIT_EVENTS_URL: must not contain credentials/,
			);
			expect(userinfo).not.toContain("pw@");
			// "id:secret" would be ambiguous once joined for HTTP Basic.
			expect(errorFor({ ...audit, AUDIT_CLIENT_ID: "hoandat:auth" })).toMatch(
				/AUDIT_CLIENT_ID:/,
			);
		});
	});

	it("collects the issuer host plus ALLOWED_HOSTS for the Host check", () => {
		const env = parseEnv({
			...REQUIRED,
			ISSUER: "http://localhost:4500",
			ALLOWED_HOSTS: "127.0.0.1:4500, LOCALHOST:4501",
		});
		expect(env.ALLOWED_HOSTS).toEqual(["127.0.0.1:4500", "localhost:4501"]);
		expect(() => parseEnv({ ...REQUIRED, ALLOWED_HOSTS: "a b" })).toThrow(
			/ALLOWED_HOSTS\.0: must list host/,
		);
	});

	it("expands the cloudflare keyword and rejects permissive proxy settings", () => {
		const env = parseEnv({ ...REQUIRED, TRUST_PROXY: "loopback, cloudflare" });
		expect(env.TRUST_PROXY).toEqual(["loopback", ...CLOUDFLARE_IP_RANGES]);
		expect(parseEnv({ ...REQUIRED, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(
			false,
		);
		for (const value of ["true", "1", "10.0.0.0/33", "example.com"]) {
			expect(() => parseEnv({ ...REQUIRED, TRUST_PROXY: value })).toThrow(
				/TRUST_PROXY/,
			);
		}
	});
});
