import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import { TELEGRAM_SENT_MESSAGE } from "../interactions/forgot-routes.js";
import { PROVIDER_RESET_REFUSED } from "../interactions/upstream-account-link.js";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import {
	type TestAccount,
	createTestAccount,
	openLoginPage,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { signInWith } from "./helpers/upstream-sign-in.js";

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

interface TakenOver {
	readonly account: TestAccount;
	readonly codes: readonly string[];
	readonly chatId: string;
	readonly googleId: string;
}

let takeovers = 0;

/** An account an intruder took over: their Telegram chat and Google account. */
async function takenOver(): Promise<TakenOver> {
	takeovers += 1;
	const chatId = `616${takeovers}`;
	const googleId = `g-intruder-${takeovers}`;
	const { codes, hashes } = await generateRecoveryCodes();
	const accounts = repositoryOf(idp);
	const account = await createTestAccount(accounts, {
		recoveryCodeHashes: [...hashes],
	});
	await accounts.links.setTelegram(account._id, { chatId });
	await accounts.links.linkProvider(account, {
		provider: "google",
		providerId: googleId,
		verifiedEmail: "intruder@gmail.com",
	});
	return { account, codes, chatId, googleId };
}

/** The owner recovers with a code and lands on the security review. */
async function ownerStartsReview(
	account: TestAccount,
	code: string,
): Promise<{ browser: TestBrowser; review: string; csrf: string }> {
	const page = await openLoginPage(idp);
	await page.browser.request(
		`${idp.issuer}/interaction/${page.uid}/forgot/recovery`,
		{
			form: {
				csrf: page.csrf,
				identifier: account.username,
				code,
				password: "owner-is-back",
				password_confirm: "owner-is-back",
			},
		},
	);
	const review = `${idp.issuer}/interaction/${page.uid}/review`;
	const html = await (await page.browser.request(review)).text();
	return { browser: page.browser, review, csrf: formField(html, "csrf") };
}

/** Opens the reset form while the link still works; returns a later GET+POST. */
async function openResetForm(
	token: string | undefined,
): Promise<() => Promise<[number, number]>> {
	const browser = new TestBrowser();
	const url = `${idp.issuer}/reset/${token ?? "missing"}`;
	const form = await browser.request(url);
	expect(form.status).toBe(200);
	const csrf = formField(await form.text(), "csrf");
	return async () => {
		const get = await browser.request(url);
		const post = await browser.request(url, {
			form: {
				csrf,
				password: "intruder-again",
				password_confirm: "intruder-again",
			},
		});
		return [get.status, post.status];
	};
}

describe("R6: reset links issued during the review die with it", () => {
	it("Telegram: nothing is sent while reviewing, and a leaked link is refused after the review", async () => {
		const { account, codes, chatId } = await takenOver();
		const owner = await ownerStartsReview(account, codes[0] ?? "");

		// The intruder asks for a Telegram link while the owner reviews.
		const before = fake.telegramMessages.length;
		const page = await openLoginPage(idp);
		const asked = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/forgot/telegram`,
			{
				form: { csrf: page.csrf, identifier: account.username },
			},
		);
		expect(await asked.text()).toContain(TELEGRAM_SENT_MESSAGE);
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(
			fake.telegramMessages.slice(before).some((m) => m.chatId === chatId),
		).toBe(false);

		// Even a link that did get out to that chat during the review...
		const leaked = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
			channel: { kind: "telegram", chatId },
		});
		const submitLater = await openResetForm(leaked);
		// ...dies once the owner removes the chat and finishes the review.
		await submitForm(owner.browser, `${owner.review}/telegram/unlink`, {
			csrf: owner.csrf,
		});
		await submitForm(
			owner.browser,
			`${owner.review}/done`,
			{ csrf: owner.csrf },
			LOCALMAN_CALLBACK,
		);
		expect(await submitLater()).toEqual([410, 410]);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))
				?.securityReviewPendingSince,
		).toBeUndefined();
	});

	it("Google: no reset link while reviewing, and a leaked one is refused after the review", async () => {
		const { account, codes, googleId } = await takenOver();
		const owner = await ownerStartsReview(account, codes[0] ?? "");

		const intruder = await signInWith(
			idp,
			fake,
			"google",
			{ id: googleId, email: "intruder@gmail.com", emailVerified: true },
			"?purpose=reset",
		);
		expect(intruder.response.status).toBe(404);
		expect(await intruder.response.text()).toContain(PROVIDER_RESET_REFUSED);

		const leaked = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
			channel: { kind: "google", providerId: googleId },
		});
		const submitLater = await openResetForm(leaked);
		await submitForm(owner.browser, `${owner.review}/unlink/google`, {
			csrf: owner.csrf,
		});
		await submitForm(
			owner.browser,
			`${owner.review}/done`,
			{ csrf: owner.csrf },
			LOCALMAN_CALLBACK,
		);
		expect(await submitLater()).toEqual([410, 410]);
	});

	it("a link issued before the owner's reset is refused after it", async () => {
		const { account, codes, chatId } = await takenOver();
		const early = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
			channel: { kind: "telegram", chatId },
		});
		const submitLater = await openResetForm(early);
		await ownerStartsReview(account, codes[0] ?? "");
		expect(await submitLater()).toEqual([410, 410]);
	});
});
