import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPageStatus, signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

const PICTURE = "https://lh3.googleusercontent.com/a/menu-picture";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

/** The header of a page: everything up to `<main`. */
function headerOf(page: string): string {
	return page.slice(0, page.indexOf("<main"));
}

describe("/account header", () => {
	it("shows the signed-in account's menu instead of the Account link", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			name: "Minh Anh",
			picture: PICTURE,
		});
		const browser = await signedInBrowser(idp, account);
		const header = headerOf(
			await (await browser.request(`${idp.issuer}/account`)).text(),
		);
		expect(header).toContain('data-id="account-menu"');
		expect(header).not.toContain('data-id="nav-account"');
		expect(header).toContain(`src="${PICTURE}"`);
		expect(header).toContain('referrerPolicy="no-referrer"');
		expect(header).toContain("Minh Anh");
		expect(header).toContain(account.email);
		expect(header).toContain('href="/account#account-sessions"');
		// This is the IdP: no "hoandat.com account" group of other apps.
		expect(header).not.toContain('data-id="account-menu-idp-email"');
		expect(header).toMatch(
			/<form class="shell-account-form" action="\/account\/sign-out" method="post"><input type="hidden" name="csrf" value="[^"]+"\/>/,
		);
	});

	it("shows it on the pages that ask before an action too", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const page = await (
			await browser.request(`${idp.issuer}/account/delete`)
		).text();
		const header = headerOf(page);
		expect(header).toContain('data-id="account-menu"');
		// No name: the username stands in for it.
		expect(header).toContain(account.username);
	});

	it("keeps the Account link for a visitor who is not signed in", async () => {
		const page = await (
			await new TestBrowser().request(`${idp.issuer}/apps`)
		).text();
		expect(headerOf(page)).toContain('data-id="nav-account"');
		expect(headerOf(page)).not.toContain('data-id="account-menu"');
	});

	it("signs out through the end-session page, which still asks first", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const portal = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		const csrf = formField(portal, "csrf");
		const ask = await browser.navigate(`${idp.issuer}/account/sign-out`, {
			form: { csrf },
		});
		expect(ask.response.status).toBe(200);
		expect(ask.response.url).toBe(`${idp.issuer}/session/end`);
		const xsrf = formField(await ask.response.text(), "xsrf");
		expect(await accountPageStatus(idp, browser)).toBe(200);
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf,
			logout: "yes",
		});
		expect(await accountPageStatus(idp, browser)).toBe(303);
	});

	it("needs the portal's CSRF token to leave for the end-session page", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const forged = await browser.request(`${idp.issuer}/account/sign-out`, {
			form: { csrf: "forged" },
		});
		expect(forged.status).toBe(303);
		expect(forged.headers.get("location")).toBe("/account?notice=expired");
	});
});
