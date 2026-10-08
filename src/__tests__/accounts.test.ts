import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
import {
	hashSecret,
	passwordProblem,
	verifySecret,
} from "../accounts/password-hasher.js";
import {
	findRecoveryCodeHash,
	generateRecoveryCodes,
	normalizeRecoveryCode,
} from "../accounts/recovery-codes.js";
import { profileToClaims } from "../oidc/claims.js";
import { createTestAccount, openTestDb } from "./helpers/test-accounts.js";

let db: Db;
let close: () => Promise<void>;
let accounts: AccountRepository;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	accounts = new AccountRepository(db);
});

afterAll(async () => {
	await close?.();
});

describe("passwords", () => {
	it("hashes with argon2id and enforces the 7-character minimum", async () => {
		const stored = await hashSecret("seven77");
		expect(stored.startsWith("$argon2id$")).toBe(true);
		expect(await verifySecret(stored, "seven77")).toBe(true);
		expect(await verifySecret(stored, "seven78")).toBe(false);
		expect(await verifySecret("not-a-hash", "seven77")).toBe(false);
		expect(passwordProblem("six666")).toMatch(/7 ký tự/);
		expect(passwordProblem("seven77")).toBeUndefined();
	});
});

describe("recovery codes", () => {
	it("issues 8 distinct xxxx-xxxx codes, each usable exactly once", async () => {
		const { codes, hashes } = await generateRecoveryCodes();
		expect(codes).toHaveLength(8);
		expect(new Set(codes).size).toBe(8);
		for (const code of codes) expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
		const account = await createTestAccount(accounts, {
			recoveryCodeHashes: [...hashes],
		});
		const [first = ""] = codes;

		const typed = first.toUpperCase().replace("-", " ");
		const matched = await findRecoveryCodeHash(
			account.recoveryCodeHashes,
			typed,
		);
		expect(matched).toBeDefined();
		expect(await accounts.consumeRecoveryCode(account._id, matched ?? "")).toBe(
			true,
		);
		// A replay of the same code, or of the consumed hash, finds nothing.
		const after = await accounts.findActiveById(account._id);
		expect(after?.recoveryCodeHashes).toHaveLength(7);
		expect(
			await findRecoveryCodeHash(after?.recoveryCodeHashes ?? [], first),
		).toBeUndefined();
		expect(await accounts.consumeRecoveryCode(account._id, matched ?? "")).toBe(
			false,
		);
	});

	it("normalises what users type and rejects malformed input", () => {
		expect(normalizeRecoveryCode(" ABCD-EFGH ")).toBe("abcd-efgh");
		expect(normalizeRecoveryCode("abcdefgh")).toBe("abcd-efgh");
		expect(normalizeRecoveryCode("abcd-efg0")).toBeUndefined();
		expect(normalizeRecoveryCode("abc")).toBeUndefined();
	});
});

describe("email_verified claim", () => {
	it("is true only when Google or GitHub verified the email", async () => {
		const typed = await createTestAccount(accounts);
		const vouched = await createTestAccount(accounts, {
			emailVerifiedBy: "github",
		});
		const claimsOf = async (sub: string) => {
			const profile = await accounts.findAccount(sub);
			return profile ? profileToClaims(profile) : undefined;
		};
		expect(await claimsOf(typed._id)).toMatchObject({
			email: typed.email,
			email_verified: false,
		});
		expect(await claimsOf(vouched._id)).toMatchObject({ email_verified: true });
	});
});
