import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type JWTVerifyGetKey,
	SignJWT,
	createLocalJWKSet,
	decodeProtectedHeader,
	exportJWK,
	generateKeyPair,
	jwtVerify,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { appleClientSecret } from "../accounts/apple-client-secret.js";
import {
	verifyAppleIdToken,
	verifyAppleNotification,
} from "../accounts/apple-signed-tokens.js";
import { appleDisplayName } from "../accounts/upstream-apple.js";
import { loadAppleKey } from "../config/apple-env.js";
import { parseEnv } from "../config/env.js";

const APPLE = "https://appleid.apple.com";
const CLIENT_ID = "com.example.auth.signin";

let keys: JWTVerifyGetKey;
let signingKey: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
	const pair = await generateKeyPair("RS256");
	signingKey = pair.privateKey;
	otherKey = (await generateKeyPair("RS256")).privateKey;
	const jwk = await exportJWK(pair.publicKey);
	keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
});

function appleJwt(
	claims: Record<string, unknown>,
	options: { key?: CryptoKey; expiresIn?: string | number } = {},
): Promise<string> {
	return new SignJWT({ aud: CLIENT_ID, sub: "001.abc.123", ...claims })
		.setProtectedHeader({ alg: "RS256", kid: "k1" })
		.setIssuer(typeof claims.iss === "string" ? claims.iss : APPLE)
		.setIssuedAt()
		.setExpirationTime(options.expiresIn ?? "10m")
		.sign(options.key ?? signingKey);
}

describe("Apple client secret", () => {
	it("is an ES256 JWT from the team for the Services ID, short-lived", async () => {
		const { privateKey, publicKey } = generateKeyPairSync("ec", {
			namedCurve: "prime256v1",
		});
		const now = new Date("2026-10-19T06:00:00Z");
		const secret = await appleClientSecret(
			{
				teamId: "TEAM123456",
				servicesId: CLIENT_ID,
				keyId: "KEY1234567",
				privateKey,
			},
			now,
		);
		expect(decodeProtectedHeader(secret)).toEqual({
			alg: "ES256",
			kid: "KEY1234567",
		});
		const { payload } = await jwtVerify(secret, publicKey, {
			currentDate: now,
		});
		expect(payload).toEqual({
			iss: "TEAM123456",
			sub: CLIENT_ID,
			aud: APPLE,
			iat: now.getTime() / 1000,
			exp: now.getTime() / 1000 + 300,
		});
	});
});

describe("Apple ID token", () => {
	const expected = (nonce = "n-1") => ({ keys, clientId: CLIENT_ID, nonce });

	it("accepts Apple's token and reads a verified relay email", async () => {
		const token = await appleJwt({
			nonce: "n-1",
			email: "x7k2@privaterelay.appleid.com",
			email_verified: "true",
			is_private_email: "true",
		});
		await expect(verifyAppleIdToken(token, expected())).resolves.toEqual({
			sub: "001.abc.123",
			verifiedEmail: "x7k2@privaterelay.appleid.com",
			privateEmail: true,
		});
	});

	it("has no email when Apple sends none (later sign-ins)", async () => {
		const token = await appleJwt({ nonce: "n-1" });
		const identity = await verifyAppleIdToken(token, expected());
		expect(identity.verifiedEmail).toBeUndefined();
	});

	it("ignores an email Apple did not verify", async () => {
		const token = await appleJwt({
			nonce: "n-1",
			email: "a@example.com",
			email_verified: false,
		});
		const identity = await verifyAppleIdToken(token, expected());
		expect(identity.verifiedEmail).toBeUndefined();
	});

	it.each([
		["another nonce", { nonce: "n-2" }, {}],
		["no nonce", {}, {}],
		["another audience", { nonce: "n-1", aud: "com.other.app" }, {}],
		["another issuer", { nonce: "n-1", iss: "https://evil.example" }, {}],
		["an expired token", { nonce: "n-1" }, { expiresIn: -120 }],
	])("rejects %s", async (_label, claims, options) => {
		const iat = Math.floor(Date.now() / 1000);
		const token = await appleJwt(
			claims,
			"expiresIn" in options ? { expiresIn: iat - 120 } : {},
		);
		await expect(verifyAppleIdToken(token, expected())).rejects.toThrow();
	});

	it("rejects a token not signed by Apple's published keys", async () => {
		const token = await appleJwt({ nonce: "n-1" }, { key: otherKey });
		await expect(verifyAppleIdToken(token, expected())).rejects.toThrow();
	});
});

describe("Apple notifications", () => {
	const audiences = [CLIENT_ID, "com.example.app"];

	it("reads events sent as a JSON string, for the primary App ID too", async () => {
		const payload = await appleJwt({
			aud: "com.example.app",
			events: JSON.stringify({
				type: "consent-revoked",
				sub: "001.abc.123",
				event_time: 1,
			}),
		});
		await expect(
			verifyAppleNotification(payload, { keys, audiences }),
		).resolves.toEqual({ type: "consent-revoked", sub: "001.abc.123" });
	});

	it("reads events sent as an object", async () => {
		const payload = await appleJwt({
			events: { type: "account-deleted", sub: "001.abc.123" },
		});
		const event = await verifyAppleNotification(payload, { keys, audiences });
		expect(event.type).toBe("account-deleted");
	});

	it("rejects a forged or foreign notification", async () => {
		const events = { type: "account-deleted", sub: "s" };
		const forged = await appleJwt({ events }, { key: otherKey });
		const foreign = await appleJwt({ events, aud: "com.other.app" });
		for (const payload of [forged, foreign, "not-a-jwt"]) {
			await expect(
				verifyAppleNotification(payload, { keys, audiences }),
			).rejects.toThrow();
		}
	});
});

describe("Apple's user field", () => {
	it("joins the names Apple shares on the first authorization", () => {
		expect(
			appleDisplayName(
				JSON.stringify({ name: { firstName: " Đạt ", lastName: "Trần" } }),
			),
		).toBe("Đạt Trần");
	});

	it("is undefined when absent or malformed", () => {
		expect(appleDisplayName(null)).toBeUndefined();
		expect(appleDisplayName("{not json")).toBeUndefined();
		expect(appleDisplayName(JSON.stringify({ name: 5 }))).toBeUndefined();
		expect(appleDisplayName(JSON.stringify({ name: {} }))).toBeUndefined();
	});
});

describe("Apple configuration", () => {
	const base = {
		NODE_ENV: "test",
		MONGO_URL: "mongodb://127.0.0.1:27017/auth",
		SIGNING_KEYS_PATH: "keys.json",
		COOKIE_KEYS: "x".repeat(32),
		LOCALMAN_WEB_CLIENT_SECRET: "x".repeat(32),
		TUNELO_WEB_CLIENT_SECRET: "x".repeat(32),
		CHAT_WEB_CLIENT_SECRET: "x".repeat(32),
	};

	it("is all-or-nothing", () => {
		expect(() =>
			parseEnv({ ...base, APPLE_TEAM_ID: "TEAM123456" }),
		).toThrowError(/APPLE_SERVICES_ID: must be set together/);
		expect(() =>
			parseEnv({ ...base, APPLE_PRIMARY_APP_ID: "com.example.app" }),
		).toThrowError(/APPLE_TEAM_ID: must be set together/);
		expect(parseEnv(base).APPLE_TEAM_ID).toBeUndefined();
	});

	it("checks the IDs' shape without echoing values", () => {
		expect(() =>
			parseEnv({
				...base,
				APPLE_TEAM_ID: "team",
				APPLE_SERVICES_ID: CLIENT_ID,
				APPLE_KEY_ID: "KEY1234567",
				APPLE_PRIVATE_KEY_PATH: "/k.p8",
			}),
		).toThrowError(/APPLE_TEAM_ID: must be the 10-character ID/);
	});

	it("loads only an EC P-256 key and never prints the file", () => {
		const dir = mkdtempSync(join(tmpdir(), "apple-key-"));
		const good = join(dir, "good.p8");
		const rsa = join(dir, "rsa.pem");
		const junk = join(dir, "junk.p8");
		const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const rs = generateKeyPairSync("rsa", { modulusLength: 2048 });
		writeFileSync(
			good,
			ec.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		);
		writeFileSync(
			rsa,
			rs.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		);
		writeFileSync(junk, "SECRET-CONTENT");
		expect(loadAppleKey(good).asymmetricKeyType).toBe("ec");
		expect(() => loadAppleKey(rsa)).toThrowError(/EC P-256/);
		expect(() => loadAppleKey(junk)).toThrowError(
			/^APPLE_PRIVATE_KEY_PATH: cannot read/,
		);
		expect(() => loadAppleKey(join(dir, "missing.p8"))).toThrowError(
			/^APPLE_PRIVATE_KEY_PATH/,
		);
		try {
			loadAppleKey(junk);
		} catch (error) {
			expect(String(error)).not.toContain("SECRET-CONTENT");
		}
	});
});
