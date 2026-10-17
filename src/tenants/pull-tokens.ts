import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The token a self-hosted install pulls release images with (ADR 0007),
 * issued when it enrolls. Only its SHA-256 is kept in the registry entry:
 * a leaked database cannot pull, and enrolling again replaces it.
 */
export function newPullToken(): {
	readonly token: string;
	readonly hash: string;
} {
	const token = `hpt_${randomBytes(32).toString("base64url")}`;
	return { token, hash: hashPullToken(token) };
}

export function hashPullToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/** True when `token` is the one whose hash is kept, compared in constant time. */
export function pullTokenMatches(
	storedHash: string | undefined,
	token: string,
): boolean {
	if (!storedHash) return false;
	const expected = Buffer.from(storedHash, "hex");
	const actual = Buffer.from(hashPullToken(token), "hex");
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}
