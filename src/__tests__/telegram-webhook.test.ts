import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

/** A link code as /account creates it: from a live session of the account. */
async function linkCodeFor(account: TestAccount): Promise<string> {
	await signedInBrowser(idp, account);
	return createTelegramLinkCode(idp.services.accountTokens, {
		accountId: account._id,
		sessionUid: await sessionUidOf(idp, account._id),
		locale: "vi",
	});
}

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", env: FAKE_UPSTREAM_ENV });
});

afterAll(async () => {
	await idp?.close();
});

describe("Telegram webhook", () => {
	const post = (body: object, secret?: string): Promise<Response> =>
		fetch(`${idp.issuer}${WEBHOOK_PATH}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				...(secret === undefined ? {} : { [SECRET_HEADER]: secret }),
			},
			body: JSON.stringify(body),
		});
	const startUpdate = (code: string) => ({
		update_id: 1,
		message: { text: `/start ${code}`, chat: { id: 4242, type: "private" } },
	});

	it("rejects a missing or wrong secret token without touching the code", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const code = await linkCodeFor(account);
		expect((await post(startUpdate(code))).status).toBe(401);
		expect(
			(await post(startUpdate(code), `${FAKE_TELEGRAM_SECRET}x`)).status,
		).toBe(401);
		expect((await post(startUpdate(code), "short")).status).toBe(401);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();

		// /start only asks for confirmation; nothing is linked yet.
		expect((await post(startUpdate(code), FAKE_TELEGRAM_SECRET)).status).toBe(
			200,
		);
		const ask = idp.fake.telegramMessages.at(-1);
		expect(ask?.text).toContain(`@${account.username}`);
		expect(ask?.callbackData).toBe(`link:${code}`);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();

		const press = (chatId: number) => ({
			update_id: 2,
			callback_query: {
				id: `cb-${chatId}`,
				data: `link:${code}`,
				message: {
					chat: {
						id: chatId,
						type: "private",
						username: "dat_tg",
						first_name: "Đạt",
					},
				},
			},
		});
		expect((await post(press(4242), FAKE_TELEGRAM_SECRET)).status).toBe(200);
		const linked = await repositoryOf(idp).findActiveById(account._id);
		expect(linked?.telegram).toMatchObject({
			chatId: "4242",
			username: "dat_tg",
			name: "Đạt",
		});
		expect(linked?.telegramLocale).toBe("vi");
		// The code was single-use: pressing again links nothing new. A used
		// code carries no language, so the reply follows the chat's Telegram
		// language (none sent here: English).
		await post(press(4242), FAKE_TELEGRAM_SECRET);
		expect(idp.fake.telegramMessages.at(-1)?.text).toMatch(
			/expired or was already used/,
		);
	});

	it("tells the previous chat when the account moves to another one", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.setTelegram(account._id, { chatId: "1111" });
		const code = await linkCodeFor(account);
		await post(
			{
				update_id: 3,
				callback_query: {
					id: "cb-2222",
					data: `link:${code}`,
					message: { chat: { id: 2222, type: "private" } },
				},
			},
			FAKE_TELEGRAM_SECRET,
		);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram?.chatId,
		).toBe("2222");
		// The old link stored no language: the old chat is told in English.
		const toOld = idp.fake.telegramMessages.filter((m) => m.chatId === "1111");
		expect(toOld.at(-1)?.text).toMatch(
			/moved its link to another Telegram chat/,
		);
	});
});
