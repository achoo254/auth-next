import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { AccountTokens } from "../accounts/account-tokens.js";
import {
	consumeTelegramLinkCode,
	createTelegramLinkCode,
} from "../telegram/link-routes.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", env: FAKE_UPSTREAM_ENV });
});

afterAll(async () => {
	await idp?.close();
});

afterEach(() => {
	vi.useRealTimers();
});

const MINUTE_MS = 60_000;

function accountTokens(): AccountTokens {
	return idp.services.accountTokens;
}

describe("Telegram link codes", () => {
	it("work once, expire after 10 minutes, and a new code replaces the old", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const owner = {
			accountId: account._id,
			sessionUid: "s3",
			locale: "vi",
		} as const;
		const first = await createTelegramLinkCode(accountTokens(), owner);
		const second = await createTelegramLinkCode(accountTokens(), owner);
		expect(first).toMatch(/^[\w-]{43}$/);
		// Stored only as a hash: the code itself is no document id.
		expect(
			await idp.db
				.collection<{ _id: string }>("one_time_tokens")
				.countDocuments({ _id: second }),
		).toBe(0);
		expect(
			await consumeTelegramLinkCode(accountTokens(), first),
		).toBeUndefined();
		expect(
			await consumeTelegramLinkCode(accountTokens(), second),
		).toMatchObject({
			account: { _id: account._id },
			sessionUid: "s3",
			locale: "vi",
		});
		expect(
			await consumeTelegramLinkCode(accountTokens(), second),
		).toBeUndefined();

		const late = await createTelegramLinkCode(accountTokens(), owner);
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 11 * MINUTE_MS);
		expect(
			await consumeTelegramLinkCode(accountTokens(), late),
		).toBeUndefined();
	});
});
