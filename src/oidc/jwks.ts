import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { calculateJwkThumbprint } from "jose";
import { z } from "zod";

/** The only signing algorithm this issuer uses for ID and access tokens. */
export const SIGNING_ALG = "ES256";

const base64url = z.string().regex(/^[A-Za-z0-9_-]+$/, "must be base64url");

const privateEcJwk = z.object({
	kty: z.literal("EC"),
	crv: z.literal("P-256"),
	x: base64url,
	y: base64url,
	d: base64url,
	kid: z.string().min(1, "kid is required"),
	alg: z.literal(SIGNING_ALG).default(SIGNING_ALG),
	use: z.literal("sig").default("sig"),
});

export type SigningJwk = z.output<typeof privateEcJwk>;

const signingJwks = z
	.object({ keys: z.array(privateEcJwk).min(1, "must contain a key") })
	.refine(
		(jwks) =>
			new Set(jwks.keys.map((key) => key.kid)).size === jwks.keys.length,
		"kid values must be unique",
	);

export interface SigningJwks {
	/** First key signs; the rest stay published so older tokens verify. */
	readonly keys: readonly SigningJwk[];
}

export class SigningKeysError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SigningKeysError";
	}
}

/** Validates a parsed JWKS document. Messages never include key material. */
export function parseSigningJwks(document: unknown): SigningJwks {
	const result = signingJwks.safeParse(document);
	if (result.success) return result.data;
	const issues = result.error.issues.map(
		(issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`,
	);
	throw new SigningKeysError(`Invalid signing keys: ${issues.join("; ")}`);
}

/** Reads the private ES256 JWKS mounted from the secrets directory. */
export async function loadSigningJwks(path: string): Promise<SigningJwks> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		throw new SigningKeysError(`Cannot read signing keys at ${path}`, {
			cause: error,
		});
	}
	let document: unknown;
	try {
		document = JSON.parse(raw);
	} catch {
		throw new SigningKeysError(`Signing keys at ${path} are not valid JSON`);
	}
	return parseSigningJwks(document);
}

/**
 * Generates a P-256 private JWK whose `kid` is its RFC 7638 thumbprint, so
 * the same key always yields the same `kid`.
 */
export async function generateSigningJwk(): Promise<SigningJwk> {
	const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
	const exported = privateKey.export({ format: "jwk" });
	const kid = await calculateJwkThumbprint({
		kty: "EC",
		crv: exported.crv,
		x: exported.x,
		y: exported.y,
	});
	return privateEcJwk.parse({ ...exported, kid });
}
