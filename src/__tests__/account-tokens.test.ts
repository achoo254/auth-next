import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
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

const KINDS: readonly AccountTokenKind[] = [
	"password-reset",
	"telegram-link",
	"upstream-link-state",
	"signup-pending",
	"review-pending",
	"review-reset",
];

interface Change {
	/** Brings the account to the state the change starts from (before issuing). */
	readonly setup?: (account: TestAccount) => Promise<unknown>;
	readonly apply: (account: TestAccount) => Promise<unknown>;
}

/** Every security-relevant change; each must void older tokens. */
const CHANGES: Readonly<Record<string, Change>> = {
	"password set/reset": {
		apply: (a) => accounts.setPassword(a._id, "$argon2id$new"),
	},
	"new recovery codes": {
		apply: (a) => accounts.replaceRecoveryCodes(a._id, ["h"]),
	},
	"review started": {
		apply: (a) => accounts.setSecurityReviewPending(a._id, true),
	},
	"review finished": {
		setup: (a) => accounts.setSecurityReviewPending(a._id, true),
		apply: (a) => accounts.setSecurityReviewPending(a._id, false),
	},
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
				provider: "google",
				providerId: `g-${a._id}`,
			}),
		apply: (a) => accounts.links.unlinkProvider(a._id, "google"),
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
				// The flow that made the change may renew its own token, with the
				// version its own write produced.
				const current =
					(await accounts.findActiveById(account._id))?.securityVersion ?? 0;
				expect(await tokens.renew(kind, token, account._id, current)).toBe(
					true,
				);
				expect((await tokens.take(kind, token)).status).toBe("ok");
				expect(await tokens.take(kind, token)).toEqual({ status: "missing" });
			});
		}
	}

	it("a token only works for its own kind", async () => {
		const account = await createTestAccount(accounts);
		await tokens.issue("password-reset", "shared-value", account._id, {}, 600);
		expect(await tokens.peek("review-reset", "shared-value")).toEqual({
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
