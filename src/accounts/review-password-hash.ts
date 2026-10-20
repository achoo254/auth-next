import {
	type ScryptOptions,
	randomBytes,
	scrypt,
	timingSafeEqual,
} from "node:crypto";

/**
 * The password of the review-only sign-in (ADR 0010), hashed with Node's
 * scrypt. Encoded as `$scrypt$ln=<log2 N>,r=<r>,p=<p>$<salt>$<hash>` (salt
 * and hash in unpadded base64url), so the parameters travel with the hash.
 */
export interface ReviewPasswordHash {
	readonly logN: number;
	readonly r: number;
	readonly p: number;
	readonly salt: Buffer;
	readonly hash: Buffer;
}

/** N = 2^15, r = 8: 32 MiB per check, about 0.1 s. */
const DEFAULT_PARAMS = { logN: 15, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
/** Bounds for a decoded hash: a stray file must not make a check hang. */
const LIMITS = { logN: [14, 17], r: [1, 8], p: [1, 4] } as const;

const FORMAT =
	/^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d)\$([A-Za-z0-9_-]{16,88})\$([A-Za-z0-9_-]{32,172})$/;

function derive(
	password: string,
	params: Omit<ReviewPasswordHash, "hash">,
	length: number,
): Promise<Buffer> {
	const options: ScryptOptions = {
		N: 2 ** params.logN,
		r: params.r,
		p: params.p,
		// scrypt needs 128 * N * r bytes; Node's default cap is 32 MiB.
		maxmem: 256 * 2 ** params.logN * params.r,
	};
	return new Promise((resolve, reject) => {
		scrypt(password, params.salt, length, options, (error, key) => {
			if (error) reject(error);
			else resolve(key);
		});
	});
}

function inRange(
	value: number,
	[min, max]: readonly [number, number],
): boolean {
	return Number.isInteger(value) && value >= min && value <= max;
}

/** Decodes an encoded hash; throws (without echoing it) when malformed. */
export function decodeReviewPasswordHash(encoded: string): ReviewPasswordHash {
	const match = FORMAT.exec(encoded.trim());
	const [, logN, r, p, salt, hash] = match ?? [];
	if (!logN || !r || !p || !salt || !hash) {
		throw new Error("not a $scrypt$ln=..,r=..,p=..$salt$hash password hash");
	}
	const decoded: ReviewPasswordHash = {
		logN: Number(logN),
		r: Number(r),
		p: Number(p),
		salt: Buffer.from(salt, "base64url"),
		hash: Buffer.from(hash, "base64url"),
	};
	if (
		!inRange(decoded.logN, LIMITS.logN) ||
		!inRange(decoded.r, LIMITS.r) ||
		!inRange(decoded.p, LIMITS.p)
	) {
		throw new Error("scrypt parameters out of the accepted range");
	}
	return decoded;
}

export function encodeReviewPasswordHash(value: ReviewPasswordHash): string {
	return `$scrypt$ln=${value.logN},r=${value.r},p=${value.p}$${value.salt.toString("base64url")}$${value.hash.toString("base64url")}`;
}

/** Hashes a new password with a random salt; returns the encoded form. */
export async function hashReviewPassword(password: string): Promise<string> {
	const params = { ...DEFAULT_PARAMS, salt: randomBytes(SALT_BYTES) };
	const hash = await derive(password, params, HASH_BYTES);
	return encodeReviewPasswordHash({ ...params, hash });
}

/** Constant-time check of `password` against a decoded hash. */
export async function verifyReviewPassword(
	stored: ReviewPasswordHash,
	password: string,
): Promise<boolean> {
	const candidate = await derive(password, stored, stored.hash.length);
	return timingSafeEqual(candidate, stored.hash);
}
