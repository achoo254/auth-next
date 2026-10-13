import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountRepository } from "../accounts/account-repository.js";
import {
	accountsCollection,
	usableSignInProviders,
} from "../accounts/user-model.js";
import { profileToClaims } from "../oidc/claims.js";
import { createTestAccount, openTestDb } from "./helpers/test-accounts.js";
import { primaryAccounts } from "./helpers/test-tenant.js";

let db: Db;
let close: () => Promise<void>;
let accounts: AccountRepository;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	accounts = primaryAccounts(db);
});

afterAll(async () => {
	await close?.();
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

describe("legacy password fields", () => {
	it("are never read: an old password-only account has no way in and no pending review", async () => {
		const legacy = await createTestAccount(accounts, { providers: {} });
		await accountsCollection(db).updateOne(
			{ _id: legacy._id },
			{
				$set: {
					passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$legacy",
					recoveryCodeHashes: ["$argon2id$legacy-code"],
					securityReviewPendingSince: new Date(),
				},
			},
		);
		const profile = await accounts.findAccount(legacy._id);
		expect(profile).toBeDefined();
		expect(JSON.stringify(profile)).not.toMatch(/password|recovery|review/i);
		const stored = await accounts.findActiveById(legacy._id);
		if (!stored) throw new Error("account vanished");
		expect(usableSignInProviders(stored, ["google", "github"])).toEqual([]);
	});
});
