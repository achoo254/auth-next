import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { calculateJwkThumbprint } from "jose";
import { z } from "zod";

/** Signs access tokens, audit events and, by default, ID tokens. */
export const SIGNING_ALG = "ES256";
/**
 * Offered for ID tokens only, to clients that register it: OpenID Connect
 * Discovery requires `RS256` among the ID token algorithms (ADR 0005).
 */
export const RSA_ID_TOKEN_ALG = "RS256";
export type SigningAlg = typeof SIGNING_ALG | typeof RSA_ID_TOKEN_ALG;

/** Smallest RSA modulus accepted, in bytes (2048 bits). */
const MIN_RSA_MODULUS_BYTES = 256;

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

const privateRsaJwk = z.object({
	kty: z.literal("RSA"),
	n: base64url.refine(
		(n) => Math.floor((n.length * 3) / 4) >= MIN_RSA_MODULUS_BYTES,
		"RSA keys must be at least 2048 bits",
	),
	e: base64url,
	d: base64url,
	p: base64url,
	q: base64url,
	dp: base64url,
	dq: base64url,
	qi: base64url,
	kid: z.string().min(1, "kid is required"),
	alg: z.literal(RSA_ID_TOKEN_ALG).default(RSA_ID_TOKEN_ALG),
	use: z.literal("sig").default("sig"),
});

export type EcSigningJwk = z.output<typeof privateEcJwk>;
export type RsaSigningJwk = z.output<typeof privateRsaJwk>;
export type SigningJwk = EcSigningJwk | RsaSigningJwk;

const signingJwks = z
	.object({
		keys: z
			.array(z.discriminatedUnion("kty", [privateEcJwk, privateRsaJwk]))
			.min(1, "must contain a key"),
	})
	.refine(
		(jwks) =>
			new Set(jwks.keys.map((key) => key.kid)).size === jwks.keys.length,
		"kid values must be unique",
	)
	.refine(
		(jwks) => jwks.keys.some((key) => key.alg === SIGNING_ALG),
		`must contain an ${SIGNING_ALG} key`,
	);

export interface SigningJwks {
	/**
	 * The first key of each algorithm signs with it; later keys stay
	 * published so tokens they signed still verify.
	 */
	readonly keys: readonly SigningJwk[];
}

export class SigningKeysError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SigningKeysError";
	}
}

/** The ES256 key that signs access tokens, audit events and ID tokens. */
export function primarySigningKey(jwks: SigningJwks): EcSigningJwk {
	const key = jwks.keys.find(
		(candidate): candidate is EcSigningJwk => candidate.kty === "EC",
	);
	if (!key) throw new SigningKeysError(`No ${SIGNING_ALG} signing key`);
	return key;
}

/** The RS256 key that signs ID tokens for clients asking for it, if any. */
export function rsaSigningKey(jwks: SigningJwks): RsaSigningJwk | undefined {
	return jwks.keys.find(
		(candidate): candidate is RsaSigningJwk => candidate.kty === "RSA",
	);
}

/** ID token algorithms this key set can sign; ES256 first (the default). */
export function idTokenSigningAlgs(jwks: SigningJwks): SigningAlg[] {
	return rsaSigningKey(jwks) ? [SIGNING_ALG, RSA_ID_TOKEN_ALG] : [SIGNING_ALG];
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

/** Reads the private JWKS mounted from the secrets directory. */
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
 * Generates a private JWK for `alg` (P-256 for ES256, RSA 2048 for RS256)
 * whose `kid` is its RFC 7638 thumbprint, so a key always has the same kid.
 */
export async function generateSigningJwk(
	alg: SigningAlg = SIGNING_ALG,
): Promise<SigningJwk> {
	if (alg === RSA_ID_TOKEN_ALG) {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const exported = privateKey.export({ format: "jwk" });
		const kid = await calculateJwkThumbprint({
			kty: "RSA",
			e: exported.e,
			n: exported.n,
		});
		return privateRsaJwk.parse({ ...exported, kid });
	}
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
