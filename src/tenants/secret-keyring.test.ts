import {
	constants,
	createHash,
	generateKeyPairSync,
	privateDecrypt,
} from "node:crypto";
import { describe, expect, it } from "vitest";
import { appClientKey, derivedClientSecrets } from "./app-client-secrets.js";
import {
	SecretKeyring,
	parseKeyring,
	recipientOf,
	sealForProvisioner,
	sealForRecipient,
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

describe("sealForRecipient", () => {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
	});
	const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

	function open(
		sealed: ReturnType<typeof sealForRecipient>,
		context: string,
	): string {
		const aesKey = privateDecrypt(
			{
				key: privateKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
			},
			Buffer.from(sealed.wrappedKey, "base64url"),
		);
		return new SecretKeyring([{ kid: sealed.kid, key: aesKey }]).open(
			sealed,
			context,
		);
	}

	it("opens only with the private key and the same tenant and kind", () => {
		const sealed = sealForRecipient("sk-key", "ten_a\nscribe-openai", pem);
		expect(sealed.kid).toBe("recipient");
		expect(Buffer.from(sealed.iv, "base64url")).toHaveLength(12);
		expect(Buffer.from(sealed.tag, "base64url")).toHaveLength(16);
		expect(open(sealed, "ten_a\nscribe-openai")).toBe("sk-key");
		expect(() => open(sealed, "ten_b\nscribe-openai")).toThrow();
		expect(() => open(sealed, "ten_a\nscribe-gemini")).toThrow();
	});

	it("names the recipient by the SHA-256 of its SPKI DER", () => {
		const der = publicKey.export({ type: "spki", format: "der" });
		const expected = createHash("sha256").update(der).digest("hex");
		expect(recipientOf(pem)).toBe(expected.slice(0, 16));
		expect(sealForRecipient("v", "c", pem).recipient).toBe(recipientOf(pem));
	});

	it("keeps the provisioner's format: kid provisioner, no recipient", () => {
		const sealed = sealForProvisioner("cf", "ten_a\ndns-cloudflare", pem);
		expect(sealed.kid).toBe("provisioner");
		expect(Object.keys(sealed).sort()).toEqual(
			["ciphertext", "iv", "kid", "tag", "wrappedKey"].sort(),
		);
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
		expect(a.chatWeb).not.toBe(a.localmanWeb);
		expect(a.chatWeb).not.toBe(a.tuneloWeb);
		expect(a.localmanWeb).toMatch(/^[\w-]{43}$/);
	});

	it("lets each app compute only its own secrets from its own key", async () => {
		const master = "m".repeat(32);
		const { createHmac } = await import("node:crypto");
		const asApp = (key: string, tenantId: string): string =>
			createHmac("sha256", key).update(tenantId).digest("base64url");
		const localmanKey = appClientKey(master, "localman-web");
		expect(asApp(localmanKey, "ten_a")).toBe(
			derivedClientSecrets(master, "ten_a").localmanWeb,
		);
		expect(asApp(localmanKey, "ten_a")).not.toBe(
			derivedClientSecrets(master, "ten_a").tuneloWeb,
		);
		expect(localmanKey).not.toBe(appClientKey(master, "tunelo-web"));
		const chatKey = appClientKey(master, "chat-web");
		expect(asApp(chatKey, "ten_a")).toBe(
			derivedClientSecrets(master, "ten_a").chatWeb,
		);
		expect(chatKey).not.toBe(localmanKey);
	});
});
