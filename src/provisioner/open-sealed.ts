import { constants, privateDecrypt } from "node:crypto";
import {
	type ProvisionerSealedValue,
	SecretKeyring,
} from "../tenants/secret-keyring.js";

/** Parses a sealed value as the internal API returns it. */
export function parseSealed(
	value: unknown,
): ProvisionerSealedValue | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const fields = ["kid", "iv", "ciphertext", "tag", "wrappedKey"].map((name) =>
		Reflect.get(value, name),
	);
	const [kid, iv, ciphertext, tag, wrappedKey] = fields;
	return fields.every((field) => typeof field === "string")
		? {
				kid: String(kid),
				iv: String(iv),
				ciphertext: String(ciphertext),
				tag: String(tag),
				wrappedKey: String(wrappedKey),
			}
		: undefined;
}

/**
 * Opens a DNS token the IdP sealed for this provisioner: the RSA private
 * key unwraps the AES key, which opens the value bound to the tenant and
 * kind (a token sealed for another tenant does not open).
 */
export function openSealed(
	sealed: ProvisionerSealedValue,
	privateKeyPem: string,
	tenantId: string,
): string {
	const key = privateDecrypt(
		{
			key: privateKeyPem,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha256",
		},
		Buffer.from(sealed.wrappedKey, "base64url"),
	);
	return new SecretKeyring([{ kid: "provisioner", key }]).open(
		sealed,
		`${tenantId}\ndns-cloudflare`,
	);
}
