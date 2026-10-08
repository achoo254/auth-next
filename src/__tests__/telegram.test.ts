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
import {
	consumePasswordResetToken,
	createPasswordResetToken,
	peekPasswordResetToken,
	sendTelegramResetLink,
} from "../telegram/reset-link-service.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;
const fake = new FakeUpstreams();
let uninstall: () => void;

beforeAll(async () => {
	uninstall = fake.install();
	idp = await startTestIdp({ interactions: "real", env: FAKE_UPSTREAM_ENV });
});

afterAll(async () => {
	uninstall?.();
	await idp?.close();
});

afterEach(() => {
	vi.useRealTimers();
});

const MINUTE_MS = 60_000;

function accountTokens(): AccountTokens {
	return idp.services.accountTokens;
}

describe("password reset links", () => {
	it("work once and are stored only as a hash", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const token = await createPasswordResetToken(accountTokens(), {
			accountId: account._id,
		});
		if (!token) throw new Error("no token issued");
		expect(
			await idp.db
				.collection<{ _id: string }>("one_time_tokens")
				.countDocuments({ _id: token }),
		).toBe(0);
		expect(await peekPasswordResetToken(accountTokens(), token)).toMatchObject({
			status: "ok",
			account: { _id: account._id },
		});
		expect(
			await consumePasswordResetToken(accountTokens(), token),
		).toMatchObject({ status: "ok" });
		expect(await consumePasswordResetToken(accountTokens(), token)).toEqual({
			status: "missing",
		});
	});

	it("expire after 15 minutes", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const token =
			(await createPasswordResetToken(accountTokens(), {
				accountId: account._id,
			})) ?? "";
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.now() + 14 * MINUTE_MS);
		expect((await peekPasswordResetToken(accountTokens(), token)).status).toBe(
			"ok",
		);
		vi.setSystemTime(Date.now() + 2 * MINUTE_MS);
		expect(
			(await consumePasswordResetToken(accountTokens(), token)).status,
		).toBe("missing");
	});

	it("are sent only to accounts with Telegram linked and no review pending", async () => {
		const bot = idp.services.telegram;
		if (!bot) throw new Error("Telegram is not configured");
		const accounts = repositoryOf(idp);
		const without = await createTestAccount(accounts);
		const linkedBase = await createTestAccount(accounts);
		await accounts.links.setTelegram(linkedBase._id, { chatId: "777" });
		const linked = await accounts.findActiveById(linkedBase._id);
		if (!linked) throw new Error("account vanished");

		const before = fake.telegramMessages.length;
		expect(
			await sendTelegramResetLink(
				bot,
				accountTokens(),
				idp.issuer,
				without,
				undefined,
			),
		).toBe(false);
		expect(
			await sendTelegramResetLink(
				bot,
				accountTokens(),
				idp.issuer,
				linked,
				undefined,
			),
		).toBe(true);
		const sent = fake.telegramMessages.slice(before);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.chatId).toBe("777");
		expect(sent[0]?.buttonUrl).toMatch(
			new RegExp(`^${idp.issuer}/reset/[\\w-]{43}$`),
		);

		await accounts.setSecurityReviewPending(linked._id, true);
		const reviewing = await accounts.findActiveById(linked._id);
		if (!reviewing) throw new Error("account vanished");
		expect(
			await sendTelegramResetLink(
				bot,
				accountTokens(),
				idp.issuer,
				reviewing,
				undefined,
			),
		).toBe(false);
	});
});

describe("Telegram link codes", () => {
	it("work once, expire after 10 minutes, and a new code replaces the old", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const owner = { accountId: account._id, sessionUid: "s3" };
		const first = await createTelegramLinkCode(accountTokens(), owner);
		const second = await createTelegramLinkCode(accountTokens(), owner);
		expect(first).toMatch(/^[\w-]{43}$/);
		expect(
			await consumeTelegramLinkCode(accountTokens(), first),
		).toBeUndefined();
		expect(
			await consumeTelegramLinkCode(accountTokens(), second),
		).toMatchObject({
			account: { _id: account._id },
			sessionUid: "s3",
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
