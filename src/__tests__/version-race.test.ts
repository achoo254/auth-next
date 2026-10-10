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
import { createTelegramLinkCode } from "../telegram/link-routes.js";
import { SECRET_HEADER, WEBHOOK_PATH } from "../telegram/webhook-routes.js";
import {
	FAKE_TELEGRAM_SECRET,
	FAKE_UPSTREAM_ENV,
} from "./helpers/fake-upstreams.js";
import { sessionUidOf, signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
	});
});

afterAll(async () => {
	await idp?.close();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Some other security change on the account (raises its version). */
function interfere(account: TestAccount): Promise<unknown> {
	return repositoryOf(idp).links.setTelegram(account._id, {
		chatId: `interfering-${account._id}`,
	});
}

/** Runs `interfere` right after the token check `method` returns. */
function changeAfter(method: "peek" | "take", account: TestAccount): void {
	const tokens: AccountTokens = idp.services.accountTokens;
	const original = tokens[method].bind(tokens);
	vi.spyOn(tokens, method).mockImplementationOnce(async (kind, token) => {
		const result = await original(kind, token);
		await interfere(account);
		return result;
	});
}

describe("a change slipped in between token check and write", () => {
	it("linking GitHub at /account: the link is not made (410)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		idp.fake.nextLogins.push({
			id: "7007",
			email: account.email,
			emailVerified: true,
		});
		changeAfter("take", account);
		const linked = await browser.navigate(`${idp.issuer}/account/link/github`, {
			form: { csrf: formField(page, "csrf") },
		});
		expect(linked.response.status).toBe(410);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.providers.github,
		).toBeUndefined();
	});

	it("Telegram link confirmation: the chat is not linked", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await signedInBrowser(idp, account);
		const code = await createTelegramLinkCode(idp.services.accountTokens, {
			accountId: account._id,
			sessionUid: await sessionUidOf(idp, account._id),
		});
		changeAfter("take", account);
		await fetch(`${idp.issuer}${WEBHOOK_PATH}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				[SECRET_HEADER]: FAKE_TELEGRAM_SECRET,
			},
			body: JSON.stringify({
				update_id: 9,
				callback_query: {
					id: "cb-race",
					data: `link:${code}`,
					message: { chat: { id: 8080, type: "private" } },
				},
			}),
		});
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram?.chatId,
		).not.toBe("8080");
		expect(idp.fake.telegramMessages.at(-1)?.text).toMatch(
			/hết hạn hoặc đã được dùng/,
		);
	});
});
