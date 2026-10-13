import {
	createCipheriv,
	createDecipheriv,
	publicEncrypt,
	randomBytes,
} from "node:crypto";
import { constants } from "node:crypto";

/** AES-256-GCM output, every part base64url. */
export interface SealedValue {
	/** Which key of the ring sealed it (rotation). */
	readonly kid: string;
	readonly iv: string;
	readonly ciphertext: string;
	readonly tag: string;
}

/**
 * Keys that encrypt tenant secrets at rest, from `TENANT_SECRETS_KEY`:
 * `kid:base64key[,kid:base64key...]`, 32-byte keys. The first key seals;
 * every key opens, so a new key is put first and the old one kept until
 * every secret was re-sealed.
 */
export class SecretKeyring {
	private readonly keys: ReadonlyMap<string, Buffer>;
	private readonly current: string;

	constructor(entries: readonly { kid: string; key: Buffer }[]) {
		const first = entries[0];
		if (!first) throw new Error("A secret keyring needs at least one key");
		for (const entry of entries) {
			if (entry.key.length !== 32) {
				throw new Error(`Secret key ${entry.kid} must be 32 bytes`);
			}
		}
		this.keys = new Map(entries.map((entry) => [entry.kid, entry.key]));
		this.current = first.kid;
	}

	/**
	 * Encrypts `plaintext`. `context` (tenant id and secret kind) is bound as
	 * additional data, so a sealed value copied to another tenant or kind
	 * fails to open.
	 */
	seal(plaintext: string, context: string): SealedValue {
		const key = this.keys.get(this.current);
		if (!key) throw new Error("Current secret key is missing");
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		cipher.setAAD(Buffer.from(context, "utf8"));
		const ciphertext = Buffer.concat([
			cipher.update(plaintext, "utf8"),
			cipher.final(),
		]);
		return {
			kid: this.current,
			iv: iv.toString("base64url"),
			ciphertext: ciphertext.toString("base64url"),
			tag: cipher.getAuthTag().toString("base64url"),
		};
	}

	/** Decrypts; throws when the key is unknown or anything was altered. */
	open(sealed: SealedValue, context: string): string {
		const key = this.keys.get(sealed.kid);
		if (!key) throw new Error(`Secret key ${sealed.kid} is not configured`);
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			Buffer.from(sealed.iv, "base64url"),
		);
		decipher.setAAD(Buffer.from(context, "utf8"));
		decipher.setAuthTag(Buffer.from(sealed.tag, "base64url"));
		return Buffer.concat([
			decipher.update(Buffer.from(sealed.ciphertext, "base64url")),
			decipher.final(),
		]).toString("utf8");
	}

	/** True when `sealed` was made with an older key and should be re-sealed. */
	isStale(sealed: SealedValue): boolean {
		return sealed.kid !== this.current;
	}
}

/** Parses `TENANT_SECRETS_KEY`; undefined when unset (single-tenant mode). */
export function parseKeyring(
	value: string | undefined,
): SecretKeyring | undefined {
	if (!value) return undefined;
	const entries = value.split(",").map((part) => {
		const [kid, encoded] = part.trim().split(":");
		if (!kid || !encoded || !/^[\w-]{1,32}$/.test(kid)) {
			throw new Error("TENANT_SECRETS_KEY entries must be kid:base64key");
		}
		return { kid, key: Buffer.from(encoded, "base64") };
	});
	return new SecretKeyring(entries);
}

/** A value only the provisioner can open (its private key never leaves it). */
export interface ProvisionerSealedValue extends SealedValue {
	/** The AES key, encrypted with RSA-OAEP-256 to the provisioner's key. */
	readonly wrappedKey: string;
}

/**
 * Seals `plaintext` for the provisioner: a fresh AES-256-GCM key encrypts
 * it, and that key is wrapped with the provisioner's RSA public key. The
 * IdP keeps the result but can never decrypt it (the DNS API token).
 */
export function sealForProvisioner(
	plaintext: string,
	context: string,
	publicKeyPem: string,
): ProvisionerSealedValue {
	const key = randomBytes(32);
	const sealed = new SecretKeyring([{ kid: "provisioner", key }]).seal(
		plaintext,
		context,
	);
	const wrappedKey = publicEncrypt(
		{
			key: publicKeyPem,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha256",
		},
		key,
	);
	return { ...sealed, wrappedKey: wrappedKey.toString("base64url") };
}
