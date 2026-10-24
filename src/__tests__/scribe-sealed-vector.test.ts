import {
	constants,
	createPrivateKey,
	createPublicKey,
	generateKeyPairSync,
	privateDecrypt,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { secretContext } from "../tenants/sealed-for-others.js";
import {
	type RecipientSealedValue,
	SecretKeyring,
	recipientOf,
	sealForRecipient,
} from "../tenants/secret-keyring.js";

/*
 * Cross-language test vector for Scribe (ADR 0012): an AI key sealed by
 * the IdP exactly as `putForScribe` seals it, with the RSA-3072 key pair
 * that opens it. The key pair exists for tests only. Scribe copies this
 * file into its own tests to prove its Rust side opens what the IdP seals.
 * Written when missing (or with REGENERATE_SCRIBE_VECTOR=1), then kept
 * unchanged in git so both repos test the same bytes.
 */

const VECTOR_PATH = join(
	import.meta.dirname,
	"fixtures",
	"scribe-sealed-vector.json",
);

interface SealedVector {
	readonly description: string;
	readonly privateKeyPkcs8Pem: string;
	readonly publicKeySpkiPem: string;
	readonly recipient: string;
	readonly tenantId: string;
	readonly vendor: string;
	readonly context: string;
	readonly plaintext: string;
	readonly sealed: RecipientSealedValue;
}

function createVector(): SealedVector {
	const { publicKey, privateKey } = generateKeyPairSync("rsa", {
		modulusLength: 3072,
	});
	const publicKeySpkiPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const tenantId = "ten_vectorTenant0001";
	const context = secretContext(tenantId, "scribe-openai");
	const plaintext = "sk-test-scribe-vector-0123456789abcdef";
	return {
		description:
			"TEST ONLY key pair. AES-256-GCM (iv 12 bytes, tag 16 bytes, AAD = context as UTF-8) under a random key wrapped with RSA-OAEP SHA-256 / MGF1 SHA-256; binary fields are base64url without padding; recipient = first 16 hex of SHA-256(SPKI DER).",
		privateKeyPkcs8Pem: privateKey
			.export({ type: "pkcs8", format: "pem" })
			.toString(),
		publicKeySpkiPem,
		recipient: recipientOf(publicKeySpkiPem),
		tenantId,
		vendor: "openai",
		context,
		plaintext,
		sealed: sealForRecipient(plaintext, context, publicKeySpkiPem),
	};
}

function loadVector(): SealedVector {
	if (
		process.env.REGENERATE_SCRIBE_VECTOR === "1" ||
		!existsSync(VECTOR_PATH)
	) {
		mkdirSync(dirname(VECTOR_PATH), { recursive: true });
		writeFileSync(VECTOR_PATH, `${JSON.stringify(createVector(), null, 2)}\n`);
	}
	return JSON.parse(readFileSync(VECTOR_PATH, "utf8")) as SealedVector;
}

function open(vector: SealedVector, context: string): string {
	const aesKey = privateDecrypt(
		{
			key: createPrivateKey(vector.privateKeyPkcs8Pem),
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha256",
		},
		Buffer.from(vector.sealed.wrappedKey, "base64url"),
	);
	return new SecretKeyring([{ kid: vector.sealed.kid, key: aesKey }]).open(
		vector.sealed,
		context,
	);
}

describe("Scribe sealed-key test vector", () => {
	const vector = loadVector();

	it("is a 3072-bit RSA key pair named by its fingerprint", () => {
		const key = createPublicKey(vector.publicKeySpkiPem);
		expect(key.asymmetricKeyDetails?.modulusLength).toBe(3072);
		expect(vector.recipient).toBe(recipientOf(vector.publicKeySpkiPem));
		expect(vector.sealed.recipient).toBe(vector.recipient);
		expect(vector.context).toBe(`${vector.tenantId}\nscribe-${vector.vendor}`);
	});

	it("opens to the plaintext, and only with its own context", () => {
		expect(open(vector, vector.context)).toBe(vector.plaintext);
		expect(() =>
			open(vector, `ten_otherTenant\nscribe-${vector.vendor}`),
		).toThrow();
	});

	it("fails to open once a byte of the ciphertext changed", () => {
		const bytes = Buffer.from(vector.sealed.ciphertext, "base64url");
		bytes[0] = (bytes[0] ?? 0) ^ 1;
		const altered = {
			...vector,
			sealed: { ...vector.sealed, ciphertext: bytes.toString("base64url") },
		};
		expect(() => open(altered, vector.context)).toThrow();
	});
});
