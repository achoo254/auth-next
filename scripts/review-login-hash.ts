/**
 * Hashes the password of the review-only sign-in (ADR 0010).
 *
 *   printf '%s' "$PASSWORD" | pnpm -s review-login:hash > review-login.hash
 *
 * The password is read from stdin only (never an argument, which would
 * land in shell history and the process list); one trailing newline is
 * dropped. Prints only the encoded scrypt hash, for the file named by
 * REVIEW_LOGIN_PASSWORD_HASH_PATH (mode 600). See docs/deployment-guide.md.
 */
import { hashReviewPassword } from "../src/accounts/review-password-hash.js";

const MIN_LENGTH = 12;
const MAX_LENGTH = 256;

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
	}
	return Buffer.concat(chunks)
		.toString("utf8")
		.replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
	if (process.argv.length > 2) {
		throw new Error("pass the password on stdin, not as an argument");
	}
	const password = await readStdin();
	if (password.length < MIN_LENGTH || password.length > MAX_LENGTH) {
		throw new Error(
			`the password must be ${MIN_LENGTH}-${MAX_LENGTH} characters`,
		);
	}
	process.stdout.write(`${await hashReviewPassword(password)}\n`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`review-login-hash failed: ${message}\n`);
	process.exit(1);
});
