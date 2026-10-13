import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeSession } from "../account-portal/session-directory.js";
import { SECRET_HEADER, WEBHOOK_PATH } from "../telegram/webhook-routes.js";
import {
	FAKE_TELEGRAM_SECRET,
	FAKE_UPSTREAM_ENV,
} from "./helpers/fake-upstreams.js";
import { sessionUidOf, signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
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

describe("Telegram link codes cannot outlive the session that made them", () => {
	it("a code made with a stolen session dies when the owner revokes that session", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const attacker = await signedInBrowser(idp, account);
		const stolenUid = await sessionUidOf(idp, account._id);
		const code = await linkCodeFrom(attacker);
		const owner = await signedInBrowser(idp, account);
		const page = await (await owner.request(`${idp.issuer}/account`)).text();
		await submitForm(
			owner,
			`${idp.issuer}/account/sessions/${stolenUid}/revoke`,
			{ csrf: formField(page, "csrf") },
		);

		const before = idp.fake.telegramMessages.length;
		await tryToLink(code, 6666);
		const toAttacker = idp.fake.telegramMessages
			.slice(before)
			.filter((m) => m.chatId === "6666");
		expect(toAttacker.some((m) => m.callbackData)).toBe(false);
		// The page had no language preference: English.
		expect(toAttacker.at(-1)?.text).toMatch(/expired or was already used/);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.telegram,
		).toBeUndefined();
	});

	it("a code dies with the session that created it (signed out)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const code = await linkCodeFrom(browser);
		const uid = await sessionUidOf(idp, account._id);
		await revokeSession(
			idp.provider,
			idp.services,
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
