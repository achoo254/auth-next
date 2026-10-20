import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import {
	type ReviewPasswordHash,
	decodeReviewPasswordHash,
} from "../accounts/review-password-hash.js";
import { isValidEmail, normalizeEmail } from "../accounts/user-model.js";

/**
 * The review-only password sign-in (ADR 0010), primary tenant only and off
 * unless both are set: the one allowed email, and a file (mode 600) with
 * the scrypt hash from `pnpm review-login:hash`.
 */
export const reviewLoginEnvShape = {
	REVIEW_LOGIN_EMAIL: z
		.string()
		.transform(normalizeEmail)
		.refine(isValidEmail, "must be an email address")
		.optional(),
	REVIEW_LOGIN_PASSWORD_HASH_PATH: z.string().min(1).optional(),
};

export const REVIEW_LOGIN_KEYS = [
	"REVIEW_LOGIN_EMAIL",
	"REVIEW_LOGIN_PASSWORD_HASH_PATH",
] as const;

export interface ReviewLoginConfig {
	/** Normalised (trimmed, lowercase). */
	readonly email: string;
	readonly passwordHash: ReviewPasswordHash;
}

const HASH_PATH = "REVIEW_LOGIN_PASSWORD_HASH_PATH";

/**
 * Reads the hash file at startup. A missing, shared or malformed file
 * stops the IdP with a message naming the variable, never the content.
 */
export function loadReviewPasswordHash(path: string): ReviewPasswordHash {
	let content: string;
	try {
		const stat = statSync(path);
		if (!stat.isFile()) throw new Error("not a file");
		if ((stat.mode & 0o077) !== 0) {
			throw new Error(
				`${HASH_PATH}: the file must not be readable by group or others (chmod 600)`,
			);
		}
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(HASH_PATH)) {
			throw error;
		}
		throw new Error(`${HASH_PATH}: cannot read that file`);
	}
	try {
		return decodeReviewPasswordHash(content);
	} catch {
		throw new Error(
			`${HASH_PATH}: the file must hold one hash from pnpm review-login:hash`,
		);
	}
}

/** Undefined (the sign-in is off) unless both variables are set. */
export function reviewLoginConfig(env: {
	readonly REVIEW_LOGIN_EMAIL?: string;
	readonly REVIEW_LOGIN_PASSWORD_HASH_PATH?: string;
}): ReviewLoginConfig | undefined {
	const { REVIEW_LOGIN_EMAIL: email, REVIEW_LOGIN_PASSWORD_HASH_PATH: path } =
		env;
	if (!email || !path) return undefined;
	return { email, passwordHash: loadReviewPasswordHash(path) };
}
