import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SECRET_HEADER, WEBHOOK_PATH } from "../telegram/webhook-routes.js";
import {
	FAKE_TELEGRAM_SECRET,
	FAKE_UPSTREAM_ENV,
} from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
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

/** Picks a language with the footer switcher and opens /account in it. */
async function openAccountIn(
	browser: TestBrowser,
	locale: string,
): Promise<string> {
	const { response } = await browser.navigate(
		`${idp.issuer}/lang?set=${locale}&return=/account`,
	);
	return response.text();
}

function lastTo(chatId: string): string | undefined {
	return idp.fake.telegramMessages.filter((m) => m.chatId === chatId).at(-1)
		?.text;
}

describe("the Telegram bot's language", () => {
	it("follows the page a link was made on: asks, answers and stores zh-CN", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const page = await openAccountIn(browser, "zh-CN");
		const linkPage = await (
			await browser.request(`${idp.issuer}/account/telegram/link`, {
				form: { csrf: formField(page, "csrf") },
			})
		).text();
		// The page names the bot's button exactly as the bot will show it.
		expect(linkPage).toContain("“确认关联”");
		const code = /value="\/start ([\w-]+)"/.exec(linkPage)?.[1] ?? "";
		// The chat's own Telegram language loses to the page's.
		const from = { id: 9100, language_code: "en" };
		const chat = { id: 9100, type: "private" };
		await webhook({
			update_id: 1,
			message: { text: `/start ${code}`, chat, from },
		});
		const ask = idp.fake.telegramMessages.at(-1);
		expect(ask?.text).toContain(`关联到 Auth Next 账号 @${account.username}`);
		expect(ask?.callbackData).toBe(`link:${code}`);

		await webhook({
			update_id: 2,
			callback_query: {
				id: "cb-9100",
				data: `link:${code}`,
				from,
				message: { chat },
			},
		});
		expect(lastTo("9100")).toContain(
			`已将 Telegram 关联到 Auth Next 账号 @${account.username}`,
		);
		const linked = await repositoryOf(idp).findActiveById(account._id);
		expect(linked?.telegram?.chatId).toBe("9100");
		expect(linked?.telegramLocale).toBe("zh-CN");
	});

	it.each([
		["zh-hans", "“关联 Telegram”"],
		["vi", "“Liên kết Telegram”"],
		["fr", "“Link Telegram”"],
		[undefined, "“Link Telegram”"],
	])(
		"answers /start without a code in the chat's language (%s)",
		async (languageCode, button) => {
			await webhook({
				update_id: 3,
				message: {
					text: "/start",
					chat: { id: 9200, type: "private" },
					from: { id: 9200, language_code: languageCode },
				},
			});
			expect(lastTo("9200")).toContain(button);
		},
	);

	it("/account updates the stored language when it changes, and only then", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.setTelegram(account._id, {
			chatId: "9300",
			locale: "vi",
		});
		const version = (await accounts.findActiveById(account._id))
			?.securityVersion;
		const browser = await signedInBrowser(idp, account);
		const write = vi.spyOn(accounts, "updateTelegramLocale");
		try {
			await openAccountIn(browser, "zh-CN");
			const updated = await accounts.findActiveById(account._id);
			expect(updated?.telegramLocale).toBe("zh-CN");
			// A language is no security change: one-time tokens stay valid.
			expect(updated?.securityVersion).toBe(version);
			expect(write).toHaveBeenCalledTimes(1);

			await browser.request(`${idp.issuer}/account`);
			expect(write).toHaveBeenCalledTimes(1);
		} finally {
			write.mockRestore();
		}
	});

	it("stores no language for an account without Telegram", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		const browser = await signedInBrowser(idp, account);
		await openAccountIn(browser, "vi");
		expect(
			(await accounts.findActiveById(account._id))?.telegramLocale,
		).toBeUndefined();
		expect(await accounts.updateTelegramLocale(account._id, "vi")).toBe(false);
	});
});
