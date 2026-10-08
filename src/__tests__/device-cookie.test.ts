import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import {
	TEST_PASSWORD,
	type TestAccount,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

// A fresh IdP per test: every test starts with empty per-IP budgets.
let idp: TestIdp;

beforeEach(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterEach(async () => {
	await idp?.close();
});

/** Signs in once (the browser keeps its device cookie), then drops the session. */
async function rememberedBrowser(
	account: TestAccount,
	password = TEST_PASSWORD,
): Promise<TestBrowser> {
	const browser = new TestBrowser();
	const page = await openLoginPage(idp, browser);
	expect((await postLogin(idp, page, account.username, password)).status).toBe(
		303,
	);
	browser.forgetCookies("_session");
	return browser;
}

async function lockFromElsewhere(account: TestAccount): Promise<void> {
	const attacker = await openLoginPage(idp);
	for (let attempt = 0; attempt < 5; attempt += 1) {
		await postLogin(idp, attacker, account.username, "guess");
	}
}

async function attempt(
	browser: TestBrowser,
	account: TestAccount,
	password: string,
): Promise<number> {
	const page = await openLoginPage(idp, browser);
	return (await postLogin(idp, page, account.username, password)).status;
}

describe("device cookies", () => {
	it("a reset password voids every earlier cookie", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const owner = await rememberedBrowser(account);
		const token = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
		});
		const resetter = new TestBrowser();
		const form = await (
			await resetter.request(`${idp.issuer}/reset/${token}`)
		).text();
		await submitForm(resetter, `${idp.issuer}/reset/${token}`, {
			csrf: formField(form, "csrf"),
			password: "after-reset-1",
			password_confirm: "after-reset-1",
		});
		await lockFromElsewhere(account);
		// The old cookie no longer exempts this browser: locked like a stranger.
		expect(await attempt(owner, account, "after-reset-1")).toBe(429);
	});

	it("a valid cookie loses its exemption after 5 wrong attempts of its own", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const owner = await rememberedBrowser(account);
		const ownerAgain = await rememberedBrowser(account);
		await lockFromElsewhere(account);
		const statuses: number[] = [];
		for (let i = 0; i < 5; i += 1)
			statuses.push(await attempt(ownerAgain, account, "typo"));
		expect(statuses).toEqual([401, 401, 401, 401, 401]);
		expect(await attempt(ownerAgain, account, TEST_PASSWORD)).toBe(429);
		// The other remembered browser still has its own budget.
		expect(await attempt(owner, account, TEST_PASSWORD)).toBe(303);
	});
});
