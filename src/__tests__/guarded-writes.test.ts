import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
import { AccountTokens } from "../accounts/account-tokens.js";
import { createTestAccount, openTestDb } from "./helpers/test-accounts.js";

let db: Db;
let close: () => Promise<void>;
let accounts: AccountRepository;
let tokens: AccountTokens;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	accounts = new AccountRepository(db);
	tokens = new AccountTokens(db, accounts);
});

afterAll(async () => {
	await close?.();
});

/** Some other security change on the account (raises its version). */
function interfere(accountId: string): Promise<unknown> {
	return accounts.replaceRecoveryCodes(accountId, ["interfering-change"]);
}

describe("guarded writes (unit)", () => {
	it("refuse when the version moved since the check, and report why", async () => {
		const account = await createTestAccount(accounts);
		const checked =
			(await accounts.findActiveById(account._id))?.securityVersion ?? 0;
		await interfere(account._id);
		expect(
			await accounts.setPassword(account._id, "$argon2id$x", checked),
		).toEqual({ applied: false, stale: true });
		expect((await accounts.findActiveById(account._id))?.passwordHash).toBe(
			account.passwordHash,
		);
		const now =
			(await accounts.findActiveById(account._id))?.securityVersion ?? 0;
		// Nothing to unlink is not "stale": only the write's precondition failed.
		expect(
			await accounts.links.unlinkProvider(account._id, "google", now),
		).toEqual({ applied: false, stale: false });
		expect(await accounts.links.unsetTelegram(account._id, now)).toEqual({
			applied: true,
			version: now + 1,
		});
	});

	it("renew kills the token when another change came after the flow's own write", async () => {
		const account = await createTestAccount(accounts);
		await tokens.issue(
			"review-reset",
			`renew-${account._id}`,
			account._id,
			{},
			600,
		);
		const own = await accounts.links.unsetTelegram(account._id);
		if (!own.applied) throw new Error("write refused");
		await interfere(account._id);
		expect(
			await tokens.renew(
				"review-reset",
				`renew-${account._id}`,
				account._id,
				own.version,
			),
		).toBe(false);
		expect(await tokens.peek("review-reset", `renew-${account._id}`)).toEqual({
			status: "missing",
		});
	});
});
