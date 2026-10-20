import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashReviewPassword } from "../accounts/review-password-hash.js";
import { parseEnv } from "./env.js";
import { reviewLoginConfig } from "./review-login-env.js";

const REQUIRED = {
	MONGO_URL: "mongodb://mongo:27017/auth?replicaSet=rs0",
	SIGNING_KEYS_PATH: "/run/secrets/signing-keys.json",
	COOKIE_KEYS: "a".repeat(32),
	LOCALMAN_WEB_CLIENT_SECRET: "a".repeat(32),
	TUNELO_WEB_CLIENT_SECRET: "b".repeat(32),
	CHAT_WEB_CLIENT_SECRET: "c".repeat(32),
};

let dir: string;
let hashFile: string;

async function writeHashFile(
	name: string,
	content: string,
	mode: number,
): Promise<string> {
	const path = join(dir, name);
	await writeFile(path, content);
	await chmod(path, mode);
	return path;
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "hoandat-auth-review-"));
	hashFile = await writeHashFile(
		"review.hash",
		`${await hashReviewPassword("correct horse battery")}\n`,
		0o600,
	);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("review login configuration", () => {
	it("is off unless both variables are set", () => {
		expect(reviewLoginConfig(parseEnv(REQUIRED))).toBeUndefined();
		expect(() =>
			parseEnv({ ...REQUIRED, REVIEW_LOGIN_EMAIL: "review@example.com" }),
		).toThrow(/REVIEW_LOGIN_PASSWORD_HASH_PATH: must be set together/);
		expect(() =>
			parseEnv({ ...REQUIRED, REVIEW_LOGIN_PASSWORD_HASH_PATH: hashFile }),
		).toThrow(/REVIEW_LOGIN_EMAIL: must be set together/);
	});

	it("normalises the email and loads the hash file", () => {
		const env = parseEnv({
			...REQUIRED,
			REVIEW_LOGIN_EMAIL: "  App.Review@Example.COM ",
			REVIEW_LOGIN_PASSWORD_HASH_PATH: hashFile,
		});
		const config = reviewLoginConfig(env);
		expect(config?.email).toBe("app.review@example.com");
		expect(config?.passwordHash.logN).toBe(15);
	});

	it("rejects a value that is not an email address", () => {
		expect(() =>
			parseEnv({
				...REQUIRED,
				REVIEW_LOGIN_EMAIL: "not-an-email",
				REVIEW_LOGIN_PASSWORD_HASH_PATH: hashFile,
			}),
		).toThrow(/REVIEW_LOGIN_EMAIL: must be an email address/);
	});

	it("stops on a missing, shared or malformed file, naming only the variable", async () => {
		const shared = await writeHashFile(
			"shared.hash",
			"$scrypt$ln=15,r=8,p=1$secret-looking-salt-value$x",
			0o644,
		);
		const garbage = await writeHashFile(
			"garbage.hash",
			"plaintext-password-oops",
			0o600,
		);
		const cases: ReadonlyArray<readonly [string, RegExp]> = [
			[join(dir, "missing.hash"), /cannot read that file/],
			[dir, /cannot read that file/],
			[shared, /chmod 600/],
			[garbage, /pnpm review-login:hash/],
		];
		for (const [path, expected] of cases) {
			let message = "";
			try {
				reviewLoginConfig({
					REVIEW_LOGIN_EMAIL: "review@example.com",
					REVIEW_LOGIN_PASSWORD_HASH_PATH: path,
				});
			} catch (error) {
				message = error instanceof Error ? error.message : String(error);
			}
			expect(message, path).toMatch(/^REVIEW_LOGIN_PASSWORD_HASH_PATH: /);
			expect(message, path).toMatch(expected);
			expect(message).not.toMatch(/plaintext|secret-looking/);
		}
	});
});
