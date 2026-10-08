import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeSession } from "../account-portal/session-directory.js";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import { SECRET_HEADER, WEBHOOK_PATH } from "../telegram/webhook-routes.js";
import {
	FAKE_TELEGRAM_SECRET,
	FAKE_UPSTREAM_ENV,
	FakeUpstreams,
} from "./helpers/fake-upstreams.js";
import { sessionUidOf, signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	openLoginPage,
	repositoryOf,
	submitForm,
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

function webhook(body: object): Promise<Response> {
	return fetch(`${idp.issuer}${WEBHOOK_PATH}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			[SECRET_HEADER]: FAKE_TELEGRAM_SECRET,
		},
		body: JSON.stringify(body),
	});
}

/** As the holder of `browser`'s session: ask /account for a link code. */
async function linkCodeFrom(browser: TestBrowser): Promise<string> {
	const page = await (await browser.request(`${idp.issuer}/account`)).text();
	const linkPage = await (
		await browser.request(`${idp.issuer}/account/telegram/link`, {
			form: { csrf: formField(page, "csrf") },
		})
	).text();
	const code = /value="\/start ([\w-]+)"/.exec(linkPage)?.[1];
	if (!code) throw new Error("no link code on the page");
	return code;
}

async function tryToLink(code: string, chatId: number): Promise<void> {
	await webhook({
		update_id: 1,
		message: { text: `/start ${code}`, chat: { id: chatId, type: "private" } },
	});
	await webhook({
		update_id: 2,
		callback_query: {
			id: `cb-${chatId}`,
			data: `link:${code}`,
			message: { chat: { id: chatId, type: "private" } },
		},
	});
}

async function resetPassword(account: TestAccount): Promise<void> {
	const token = await createPasswordResetToken(idp.services.accountTokens, {
		accountId: account._id,
	});
	const owner = new TestBrowser();
	const form = await (
		await owner.request(`${idp.issuer}/reset/${token}`)
	).text();
	await submitForm(owner, `${idp.issuer}/reset/${token}`, {
		csrf: formField(form, "csrf"),
		password: "owner-new-password",
		password_confirm: "owner-new-password",
	});
}

describe("Telegram link codes cannot outlive the session that made them", () => {
	it("a code made with a stolen session dies when the owner resets the password", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const attacker = await signedInBrowser(idp, account);
		const code = await linkCodeFrom(attacker);
		await resetPassword(account);

		const before = fake.telegramMessages.length;
		await tryToLink(code, 6666);
		const toAttacker = fake.telegramMessages
			.slice(before)
			.filter((m) => m.chatId === "6666");
		expect(toAttacker.some((m) => m.callbackData)).toBe(false);
		expect(toAttacker.at(-1)?.text).toMatch(/hết hạn hoặc đã được dùng/);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();

		// So a later Telegram reset request sends nothing to the attacker.
		const page = await openLoginPage(idp);
		await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/forgot/telegram`,
			{
				form: { csrf: page.csrf, identifier: account.username },
			},
		);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(
			fake.telegramMessages
				.slice(before)
				.some((m) => m.chatId === "6666" && m.buttonUrl),
		).toBe(false);
	});

	it("a code dies with the session that created it (signed out)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const code = await linkCodeFrom(browser);
		const uid = await sessionUidOf(idp, account._id);
		await revokeSession(
			idp.provider,
			idp.db,
			idp.services.logger,
			account._id,
			uid,
		);
		await tryToLink(code, 7777);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();
	});
});
