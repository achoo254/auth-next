import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	SigningKeysError,
	generateSigningJwk,
	idTokenSigningAlgs,
	loadSigningJwks,
	parseSigningJwks,
	primarySigningKey,
	rsaSigningKey,
} from "./jwks.js";

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "hoandat-auth-jwks-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("signing keys", () => {
	it("generates P-256 keys whose kid is the key thumbprint", async () => {
		const key = await generateSigningJwk();
		expect(key).toMatchObject({
			kty: "EC",
			crv: "P-256",
			alg: "ES256",
			use: "sig",
		});
		expect(key.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(key.d).toEqual(expect.any(String));
	});

	it("loads several keys in order; the first one signs", async () => {
		const keys = [await generateSigningJwk(), await generateSigningJwk()];
		const path = join(dir, "keys.json");
		await writeFile(path, JSON.stringify({ keys }));
		const loaded = await loadSigningJwks(path);
		expect(loaded.keys.map((key) => key.kid)).toEqual(
			keys.map((key) => key.kid),
		);
	});

	it("rejects keys without kid, duplicate kids and unsupported keys", async () => {
		const key = await generateSigningJwk();
		const { kid: _kid, ...withoutKid } = key;
		expect(() => parseSigningJwks({ keys: [withoutKid] })).toThrow(
			SigningKeysError,
		);
		expect(() => parseSigningJwks({ keys: [key, key] })).toThrow(
			/kid values must be unique/,
		);
		expect(() =>
			parseSigningJwks({ keys: [{ ...key, crv: "P-384" }] }),
		).toThrow(SigningKeysError);
		expect(() => parseSigningJwks({ keys: [] })).toThrow(/must contain a key/);
	});

	it("generates RSA keys for RS256 ID tokens, kid being the thumbprint", async () => {
		const key = await generateSigningJwk("RS256");
		expect(key).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
		expect(key.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it("signs with the first key of each algorithm", async () => {
		const rsa = await generateSigningJwk("RS256");
		const [first, second] = [
			await generateSigningJwk(),
			await generateSigningJwk(),
		];
		const jwks = parseSigningJwks({ keys: [rsa, first, second] });
		expect(primarySigningKey(jwks).kid).toBe(first?.kid);
		expect(rsaSigningKey(jwks)?.kid).toBe(rsa.kid);
		expect(idTokenSigningAlgs(jwks)).toEqual(["ES256", "RS256"]);
		const ecOnly = parseSigningJwks({ keys: [first] });
		expect(rsaSigningKey(ecOnly)).toBeUndefined();
		expect(idTokenSigningAlgs(ecOnly)).toEqual(["ES256"]);
	});

	it("needs an ES256 key and RSA keys of at least 2048 bits", async () => {
		const rsa = await generateSigningJwk("RS256");
		expect(() => parseSigningJwks({ keys: [rsa] })).toThrow(
			/must contain an ES256 key/,
		);
		const ec = await generateSigningJwk();
		const short = { ...rsa, n: rsa.kty === "RSA" ? rsa.n.slice(0, 170) : "" };
		expect(() => parseSigningJwks({ keys: [ec, short] })).toThrow(
			/at least 2048 bits/,
		);
	});

	it("never puts private key material in error messages", async () => {
		const key = await generateSigningJwk();
		let message = "";
		try {
			parseSigningJwks({ keys: [{ ...key, kty: "RSA" }] });
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message).not.toContain(key.d);
	});

	it("reports unreadable and malformed files clearly", async () => {
		await expect(loadSigningJwks(join(dir, "missing.json"))).rejects.toThrow(
			/Cannot read signing keys/,
		);
		const path = join(dir, "broken.json");
		await writeFile(path, "{not json");
		await expect(loadSigningJwks(path)).rejects.toThrow(/not valid JSON/);
	});
});
