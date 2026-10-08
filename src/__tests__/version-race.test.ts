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
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import { SECRET_HEADER, WEBHOOK_PATH } from "../telegram/webhook-routes.js";
import {
	FAKE_TELEGRAM_SECRET,
	FAKE_UPSTREAM_ENV,
	FakeUpstreams,
} from "./helpers/fake-upstreams.js";
import { sessionUidOf, signedInBrowser } from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	type TestAccount,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;
const fake = new FakeUpstreams();
let uninstall: () => void;

beforeAll(async () => {
	uninstall = fake.install();
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
	});
});

afterAll(async () => {
	uninstall?.();
	await idp?.close();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Some other security change on the account (raises its version). */
function interfere(account: TestAccount): Promise<unknown> {
	return repositoryOf(idp).replaceRecoveryCodes(account._id, [
		"interfering-change",
	]);
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
	it("reset link: the new password is not set (410)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const token = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
		});
		const browser = new TestBrowser();
		const url = `${idp.issuer}/reset/${token ?? ""}`;
		const csrf = formField(await (await browser.request(url)).text(), "csrf");
		changeAfter("take", account);
		const post = await browser.request(url, {
			form: { csrf, password: "never-set-1", password_confirm: "never-set-1" },
		});
		expect(post.status).toBe(410);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.passwordHash,
		).toBe(account.passwordHash);
	});

	it("security review: removing a provider is refused (410) and nothing is removed", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.linkProvider(account, {
			provider: "google",
			providerId: `g-race-${account._id}`,
		});
		await accounts.setSecurityReviewPending(account._id, true);
		const page = await openLoginPage(idp);
		await postLogin(idp, page, account.username, TEST_PASSWORD);
		const base = `${idp.issuer}/interaction/${page.uid}/review`;
		const csrf = formField(
			await (await page.browser.request(base)).text(),
			"csrf",
		);
		changeAfter("peek", account);
		const unlink = await page.browser.request(`${base}/unlink/google`, {
			form: { csrf },
		});
		expect(unlink.status).toBe(410);
		expect(
			(await accounts.findActiveById(account._id))?.providers.google,
		).toBeDefined();
	});

	it("security review: a change after the review's own write kills its token", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.setTelegram(account._id, {
			chatId: `t-race-${account._id}`,
		});
		await accounts.setSecurityReviewPending(account._id, true);
		const page = await openLoginPage(idp);
		await postLogin(idp, page, account.username, TEST_PASSWORD);
		const base = `${idp.issuer}/interaction/${page.uid}/review`;
		const csrf = formField(
			await (await page.browser.request(base)).text(),
			"csrf",
		);
		const tokens = idp.services.accountTokens;
		const renew = tokens.renew.bind(tokens);
		vi.spyOn(tokens, "renew").mockImplementationOnce(async (...args) => {
			await interfere(account);
			return renew(...args);
		});
		const unlink = await page.browser.request(`${base}/telegram/unlink`, {
			form: { csrf },
		});
		expect(unlink.status).toBe(410);
		// The review's token is gone: the page sends the browser back to sign in.
		expect((await page.browser.request(base)).status).toBe(303);
		const done = await page.browser.request(`${base}/done`, { form: { csrf } });
		expect(done.status).toBe(303);
		expect(
			(await accounts.findActiveById(account._id))?.securityReviewPendingSince,
		).toBeDefined();
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
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();
		expect(fake.telegramMessages.at(-1)?.text).toMatch(
			/hết hạn hoặc đã được dùng/,
		);
	});
});
