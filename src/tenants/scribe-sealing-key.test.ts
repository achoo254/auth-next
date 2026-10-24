import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";
import { recipientOf } from "./secret-keyring.js";
import { readScribeSealingKey } from "./tenancy.js";

const REQUIRED = {
	MONGO_URL: "mongodb://mongo:27017/auth?replicaSet=rs0",
	SIGNING_KEYS_PATH: "/run/secrets/signing-keys.json",
	COOKIE_KEYS: "a".repeat(32),
	LOCALMAN_WEB_CLIENT_SECRET: "b".repeat(32),
	TUNELO_WEB_CLIENT_SECRET: "c".repeat(32),
	CHAT_WEB_CLIENT_SECRET: "d".repeat(32),
};

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "scribe-key-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

async function writeKey(name: string, pem: string | Buffer): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, pem);
	return path;
}

describe("SCRIBE_TENANTS", () => {
	it("is off unless set to true or 1, and needs Scribe's key when on", () => {
		const withKey = { ...REQUIRED, SCRIBE_SEALING_PUBLIC_KEY_PATH: "/k.pem" };
		expect(parseEnv(REQUIRED).SCRIBE_TENANTS).toBe(false);
		expect(parseEnv({ ...withKey, SCRIBE_TENANTS: "1" }).SCRIBE_TENANTS).toBe(
			true,
		);
		expect(
			parseEnv({ ...withKey, SCRIBE_TENANTS: "true" }).SCRIBE_TENANTS,
		).toBe(true);
		expect(() => parseEnv({ ...REQUIRED, SCRIBE_TENANTS: "true" })).toThrow(
			/SCRIBE_SEALING_PUBLIC_KEY_PATH/,
		);
		expect(() => parseEnv({ ...REQUIRED, SCRIBE_TENANTS: "yes" })).toThrow(
			/SCRIBE_TENANTS/,
		);
	});
});

describe("readScribeSealingKey", () => {
	it("takes an RSA public key of 3072 bits and names it", async () => {
		const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
		const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
		const key = await readScribeSealingKey(await writeKey("ok.pem", pem));
		expect(key.publicKey).toBe(pem);
		expect(key.recipient).toBe(recipientOf(pem));
		expect(key.recipient).toMatch(/^[0-9a-f]{16}$/);
	});

	it("refuses Scribe's private key", async () => {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
		const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
		await expect(
			readScribeSealingKey(await writeKey("private.pem", pem)),
		).rejects.toThrow(/private key/);
	});

	it("refuses a short RSA key or another kind of key", async () => {
		const short = generateKeyPairSync("rsa", { modulusLength: 2048 })
			.publicKey.export({ type: "spki", format: "pem" })
			.toString();
		const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
			.publicKey.export({ type: "spki", format: "pem" })
			.toString();
		for (const [name, pem] of [
			["short.pem", short],
			["ec.pem", ec],
		] as const) {
			await expect(
				readScribeSealingKey(await writeKey(name, pem)),
			).rejects.toThrow(/at least 3072 bits/);
		}
	});
});
