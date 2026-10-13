import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountRepository } from "../accounts/account-repository.js";
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

/** Some other security change on the account (raises its version). */
function interfere(accountId: string): Promise<unknown> {
	return accounts.links.setTelegram(accountId, {
		chatId: `interfering-${accountId}`,
	});
}

describe("guarded writes (unit)", () => {
	it("refuse when the version moved since the check, and report why", async () => {
		const account = await createTestAccount(accounts);
		const checked =
			(await accounts.findActiveById(account._id))?.securityVersion ?? 0;
		await interfere(account._id);
		expect(
			await accounts.links.linkProvider(
				account,
				{ provider: "github", providerId: `gh-${account._id}` },
				checked,
			),
		).toEqual({ applied: false, stale: true });
		expect(
			(await accounts.findActiveById(account._id))?.providers.github,
		).toBeUndefined();
		const now =
			(await accounts.findActiveById(account._id))?.securityVersion ?? 0;
		// Nothing to unlink is not "stale": only the write's precondition failed.
		expect(
			await accounts.links.unlinkProvider(account._id, "github", now),
		).toEqual({ applied: false, stale: false });
		expect(await accounts.links.unsetTelegram(account._id, now)).toEqual({
			applied: true,
			version: now + 1,
		});
	});
});
