import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { derivedClientSecrets } from "./app-client-secrets.js";
import {
	SecretKeyring,
	parseKeyring,
	sealForProvisioner,
} from "./secret-keyring.js";

const key = (byte: number): Buffer => Buffer.alloc(32, byte);

describe("SecretKeyring", () => {
	it("opens what it sealed, only for the same tenant and kind", () => {
		const ring = new SecretKeyring([{ kid: "k1", key: key(1) }]);
		const sealed = ring.seal("client-secret", "ten_a\ngoogle");
		expect(sealed.ciphertext).not.toContain("client-secret");
		expect(ring.open(sealed, "ten_a\ngoogle")).toBe("client-secret");
		expect(() => ring.open(sealed, "ten_b\ngoogle")).toThrow();
		expect(() => ring.open(sealed, "ten_a\ngithub")).toThrow();
		expect(() =>
			ring.open(
				{ ...sealed, tag: Buffer.alloc(16).toString("base64url") },
				"ten_a\ngoogle",
			),
		).toThrow();
	});

	it("rotates: the new first key seals, old keys still open", () => {
		const old = new SecretKeyring([{ kid: "k1", key: key(1) }]);
		const sealed = old.seal("v", "t\nk");
		const rotated = new SecretKeyring([
			{ kid: "k2", key: key(2) },
			{ kid: "k1", key: key(1) },
		]);
		expect(rotated.open(sealed, "t\nk")).toBe("v");
		expect(rotated.isStale(sealed)).toBe(true);
		expect(rotated.seal("v", "t\nk").kid).toBe("k2");
	});

	it("parses TENANT_SECRETS_KEY and refuses short or malformed keys", () => {
		const value = `k2:${key(2).toString("base64")},k1:${key(1).toString("base64")}`;
		expect(parseKeyring(value)?.seal("v", "c").kid).toBe("k2");
		expect(parseKeyring(undefined)).toBeUndefined();
		expect(() => parseKeyring("k1:c2hvcnQ=")).toThrow(/32 bytes/);
		expect(() => parseKeyring("no-separator")).toThrow();
	});
});

describe("sealForProvisioner", () => {
	it("can only be opened with the provisioner's private key", () => {
		const { publicKey, privateKey } = generateKeyPairSync("rsa", {
			modulusLength: 2048,
		});
		const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
		const sealed = sealForProvisioner("cf-token", "ten_a\ndns-cloudflare", pem);
		const aesKey = privateDecrypt(
			{
				key: privateKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
			},
			Buffer.from(sealed.wrappedKey, "base64url"),
		);
		const ring = new SecretKeyring([{ kid: "provisioner", key: aesKey }]);
		expect(ring.open(sealed, "ten_a\ndns-cloudflare")).toBe("cf-token");
	});
});

describe("derivedClientSecrets", () => {
	it("is stable per tenant and differs between tenants and clients", () => {
		const secret = "s".repeat(32);
		const a = derivedClientSecrets(secret, "ten_a");
		expect(derivedClientSecrets(secret, "ten_a")).toEqual(a);
		expect(derivedClientSecrets(secret, "ten_b").localmanWeb).not.toBe(
			a.localmanWeb,
		);
		expect(a.localmanWeb).not.toBe(a.tuneloWeb);
		expect(a.localmanWeb).toMatch(/^[\w-]{43}$/);
	});
});
