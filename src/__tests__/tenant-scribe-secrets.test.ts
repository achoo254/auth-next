import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SecretKeyring, recipientOf } from "../tenants/secret-keyring.js";
import {
	type IdpSecretKind,
	TENANT_SECRETS_COLLECTION,
	TenantSecrets,
} from "../tenants/tenant-secrets.js";
import { openTestDb } from "./helpers/test-accounts.js";

/*
 * AI keys sealed for Scribe (ADR 0012): the IdP writes them but cannot
 * read them back, re-sealing at startup leaves them alone, and Scribe's
 * reports only mark the key it actually opened.
 */

let db: Db;
let close: () => Promise<void>;
const ring = (kid: string, byte: number) =>
	new SecretKeyring([{ kid, key: Buffer.alloc(32, byte) }]);
const scribeKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const scribePem = scribeKey.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
const otherPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
	.publicKey.export({ type: "spki", format: "pem" })
	.toString();
/** A made-up key (never a real credential). */
const fakeKey = (tail: string): string =>
	["sk", "tenant", "scribe", tail].join("-");

beforeAll(async () => {
	({ db, close } = await openTestDb());
});

afterAll(async () => {
	await close?.();
});

describe("AI keys sealed for Scribe", () => {
	it("are stored sealed with a hint, and never read back by the IdP", async () => {
		const secrets = new TenantSecrets(db, ring("k1", 1));
		await secrets.putForScribe("ten_a", "openai", fakeKey("A1b2"), scribePem);
		const stored = await db
			.collection(TENANT_SECRETS_COLLECTION)
			.findOne({ _id: "ten_a:scribe-openai" as never });
		expect(stored).toMatchObject({
			tenantId: "ten_a",
			kind: "scribe-openai",
			forProvisioner: true,
			sealedFor: "scribe",
			hint: "A1b2",
		});
		expect(JSON.stringify(stored)).not.toContain(fakeKey("A1b2"));
		// `get` refuses whatever the caller claims the kind to be.
		const kind = "scribe-openai" as IdpSecretKind;
		expect(await secrets.get("ten_a", kind)).toBeUndefined();
		expect(await secrets.sealedForProvisioner("ten_a")).toBeUndefined();
	});

	it("open with Scribe's private key under the tenant and kind", async () => {
		const secrets = new TenantSecrets(db, ring("k1", 1));
		const [key] = await secrets.sealedForScribe("ten_a");
		expect(key).toMatchObject({ vendor: "openai", hint: "A1b2" });
		const sealed = key?.sealed;
		if (!sealed) throw new Error("missing sealed key");
		expect(sealed.recipient).toBe(recipientOf(scribePem));
		const aes = privateDecrypt(
			{
				key: scribeKey.privateKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
			},
			Buffer.from(sealed.wrappedKey, "base64url"),
		);
		const opener = new SecretKeyring([{ kid: sealed.kid, key: aes }]);
		expect(opener.open(sealed, "ten_a\nscribe-openai")).toBe(fakeKey("A1b2"));
		expect(() => opener.open(sealed, "ten_b\nscribe-openai")).toThrow();
	});

	it("are skipped when the IdP re-seals its own secrets with a new key", async () => {
		const old = new TenantSecrets(db, ring("k1", 1));
		await old.put("ten_a", "google", '{"clientId":"g","clientSecret":"s"}');
		const rotated = new TenantSecrets(
			db,
			new SecretKeyring([
				{ kid: "k2", key: Buffer.alloc(32, 2) },
				{ kid: "k1", key: Buffer.alloc(32, 1) },
			]),
		);
		expect(await rotated.resealStale()).toBe(1);
		expect(await rotated.get("ten_a", "google")).toContain('"clientId":"g"');
		expect(await rotated.sealedForScribe("ten_a")).toHaveLength(1);
	});

	it("are listed per tenant in vendor order", async () => {
		const secrets = new TenantSecrets(db, ring("k1", 1));
		await secrets.putForScribe(
			"ten_a",
			"anthropic",
			fakeKey("Zz99"),
			scribePem,
		);
		await secrets.putForScribe(
			"ten_a",
			"elevenlabs",
			fakeKey("El11"),
			scribePem,
		);
		await secrets.putForScribe("ten_b", "gemini", fakeKey("Ge22"), scribePem);
		const vendors = (await secrets.sealedForScribe("ten_a")).map(
			(k) => k.vendor,
		);
		expect(vendors).toEqual(["elevenlabs", "openai", "anthropic"]);
		const other = await secrets.sealedForScribe("ten_b");
		expect(other.map((k) => k.vendor)).toEqual(["gemini"]);
	});

	it("take Scribe's report only for the key it opened", async () => {
		const secrets = new TenantSecrets(db, ring("k1", 1));
		const recipient = recipientOf(scribePem);
		expect(
			await secrets.setScribeStatus(
				"ten_a",
				"openai",
				"0".repeat(16),
				"invalid",
			),
		).toBe(false);
		expect(
			await secrets.setScribeStatus("ten_b", "openai", recipient, "invalid"),
		).toBe(false);
		expect(
			await secrets.setScribeStatus("ten_a", "openai", recipient, "quota"),
		).toBe(true);
		const reported = await secrets.sealedForScribe("ten_a");
		expect(reported.find((k) => k.vendor === "openai")?.status).toBe("quota");
		// Saved again (here to a rotated key): the old report is gone.
		await secrets.putForScribe("ten_a", "openai", fakeKey("New3"), otherPem);
		const resaved = await secrets.sealedForScribe("ten_a");
		const openai = resaved.find((k) => k.vendor === "openai");
		expect(openai?.status).toBeUndefined();
		expect(openai?.sealed.recipient).toBe(recipientOf(otherPem));
		expect(
			await secrets.setScribeStatus("ten_a", "openai", recipient, "invalid"),
		).toBe(false);
	});
});
