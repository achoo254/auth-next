import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const MIN_PASSWORD_LENGTH = 7;
export const MAX_PASSWORD_LENGTH = 256;

/**
 * argon2id (the library default) with the OWASP baseline: 19 MiB memory,
 * two passes, one lane. Parameters live in each PHC string, so raising them
 * later still verifies old hashes.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
	return hash(secret, OPTIONS);
}

/** False for a wrong secret and for a malformed stored hash. */
export async function verifySecret(
	storedHash: string,
	secret: string,
): Promise<boolean> {
	try {
		return await verify(storedHash, secret);
	} catch {
		return false;
	}
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same work as a real check against a hash nobody knows, so a
 * login for a missing account takes as long as one with a wrong password.
 */
export async function burnPasswordCheck(secret: string): Promise<void> {
	dummyHash ??= hashSecret(randomBytes(32).toString("base64url"));
	await verifySecret(await dummyHash, secret);
}

/** Vietnamese reason a new password is refused, or undefined when it is fine. */
export function passwordProblem(password: string): string | undefined {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
	}
	if (password.length > MAX_PASSWORD_LENGTH) {
		return `Mật khẩu dài tối đa ${MAX_PASSWORD_LENGTH} ký tự.`;
	}
	return undefined;
}
