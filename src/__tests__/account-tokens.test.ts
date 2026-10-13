import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountRepository } from "../accounts/account-repository.js";
import {
	AccountTokens,
	type TokenChannel,
	isTokenCurrent,
} from "../accounts/account-tokens.js";
import type { AccountTokenKind } from "../accounts/one-time-tokens.js";
import type { AccountDocument } from "../accounts/user-model.js";
import {
	type TestAccount,
	createTestAccount,
	openTestDb,
} from "./helpers/test-accounts.js";
import { primaryAccounts } from "./helpers/test-tenant.js";

let db: Db;
let close: () => Promise<void>;
let accounts: AccountRepository;
let tokens: AccountTokens;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	accounts = primaryAccounts(db);
	tokens = new AccountTokens(db, accounts);
});

afterAll(async () => {
	await close?.();
});

const KINDS: readonly AccountTokenKind[] = [
	"telegram-link",
	"upstream-link-state",
];

interface Change {
	/** Brings the account to the state the change starts from (before issuing). */
	readonly setup?: (account: TestAccount) => Promise<unknown>;
	readonly apply: (account: TestAccount) => Promise<unknown>;
}

/** Every security-relevant change; each must void older tokens. */
const CHANGES: Readonly<Record<string, Change>> = {
	"provider linked": {
		apply: (a) =>
			accounts.links.linkProvider(a, {
				provider: "github",
				providerId: `gh-${a._id}`,
			}),
	},
	"provider unlinked": {
		setup: (a) =>
			accounts.links.linkProvider(a, {
				provider: "github",
				providerId: `gh-${a._id}`,
			}),
		apply: (a) => accounts.links.unlinkProvider(a._id, "github"),
	},
	"Telegram linked": {
		apply: (a) => accounts.links.setTelegram(a._id, { chatId: `c-${a._id}` }),
	},
	"Telegram unlinked": {
		setup: (a) => accounts.links.setTelegram(a._id, { chatId: `c-${a._id}` }),
		apply: (a) => accounts.links.unsetTelegram(a._id),
	},
	"email reclaimed": { apply: (a) => accounts.links.reclaimEmail(a.email) },
};

describe("account tokens stop working after any security change", () => {
	for (const kind of KINDS) {
		for (const [change, { setup, apply }] of Object.entries(CHANGES)) {
			it(`${kind} × ${change}`, async () => {
				const account = await createTestAccount(accounts);
				await setup?.(account);
				const token = `${kind}-${change}-${account._id}`;
				expect(
					await tokens.issue(kind, token, account._id, { extra: "x" }, 600),
				).toBe(true);
				expect(await tokens.peek(kind, token)).toMatchObject({
					status: "ok",
					data: { extra: "x" },
				});
				await apply(account);
				expect(await tokens.peek(kind, token)).toEqual({ status: "stale" });
				// Using a stale token still uses it up.
				expect(await tokens.take(kind, token)).toEqual({ status: "stale" });
				expect(await tokens.take(kind, token)).toEqual({ status: "missing" });
			});
		}
	}

	it("a token only works for its own kind", async () => {
		const account = await createTestAccount(accounts);
		await tokens.issue("telegram-link", "shared-value", account._id, {}, 600);
		expect(await tokens.peek("upstream-link-state", "shared-value")).toEqual({
			status: "missing",
		});
	});
});

describe("isTokenCurrent", () => {
	const base = {
		_id: "acc_x",
		securityVersion: 3,
		telegram: { chatId: "42", linkedAt: new Date() },
		providers: { google: "g-1" },
	};
	const account = base as unknown as AccountDocument;
	const stamp = (fields: Record<string, string>) => ({
		accountId: "acc_x",
		securityVersion: "3",
		...fields,
	});
	const channel = (value: TokenChannel): string =>
		value.kind === "telegram"
			? `telegram:${value.chatId}`
			: `${value.kind}:${value.providerId}`;
	const cases: [
		string,
		AccountDocument | undefined,
		Record<string, string>,
		boolean,
	][] = [
		["current, no channel", account, stamp({}), true],
		[
			"current, Telegram chat still linked",
			account,
			stamp({ channel: channel({ kind: "telegram", chatId: "42" }) }),
			true,
		],
		[
			"Telegram chat no longer linked",
			account,
			stamp({ channel: channel({ kind: "telegram", chatId: "41" }) }),
			false,
		],
		[
			"Google account still linked",
			account,
			stamp({ channel: channel({ kind: "google", providerId: "g-1" }) }),
			true,
		],
		[
			"Google account no longer linked",
			account,
			stamp({ channel: channel({ kind: "google", providerId: "g-2" }) }),
			false,
		],
		[
			"GitHub never linked",
			account,
			stamp({ channel: channel({ kind: "github", providerId: "1" }) }),
			false,
		],
		["older version", account, stamp({ securityVersion: "2" }), false],
		["other account", account, stamp({ accountId: "acc_y" }), false],
		["account gone", undefined, stamp({}), false],
		[
			"account disabled",
			{ ...base, disabledAt: new Date() } as unknown as AccountDocument,
			stamp({}),
			false,
		],
	];
	for (const [name, who, data, expected] of cases) {
		it(name, () => {
			expect(isTokenCurrent(who, data)).toBe(expected);
		});
	}
});
