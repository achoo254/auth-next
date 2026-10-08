import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { providerDetail } from "../accounts/account-links.js";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

const NEW_PASSWORD = "after-the-reset";

/** An account someone may have tampered with: Google, Telegram, old codes. */
async function tamperedAccount(): Promise<{
	account: TestAccount;
	codes: readonly string[];
}> {
	const { codes, hashes } = await generateRecoveryCodes();
	const accounts = repositoryOf(idp);
	const account = await createTestAccount(accounts, {
		recoveryCodeHashes: [...hashes],
	});
	await accounts.links.linkProvider(account, {
		provider: "google",
		providerId: "g-intruder",
		verifiedEmail: "intruder@gmail.com",
	});
	await accounts.links.setTelegram(account._id, {
		chatId: "999",
		username: "intruder_tg",
	});
	return { account, codes };
}

describe("security review after a password reset", () => {
	it("stops the recovery-code sign-in at the review until the owner confirms", async () => {
		const { account, codes } = await tamperedAccount();
		const page = await openLoginPage(idp);
		const reset = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/forgot/recovery`,
			{
				form: {
					csrf: page.csrf,
					identifier: account.username,
					code: codes[0] ?? "",
					password: NEW_PASSWORD,
					password_confirm: NEW_PASSWORD,
				},
			},
		);
		expect(reset.headers.get("location")).toBe(
			`/interaction/${page.uid}/review`,
		);
		const reviewUrl = `${idp.issuer}/interaction/${page.uid}/review`;
		const review = await (await page.browser.request(reviewUrl)).text();
		expect(review).toContain("Rà soát bảo mật");
		expect(review).toContain("intruder@gmail.com");
		expect(review).toContain("@intruder_tg");
		expect(review).toContain("Còn <b>7</b> mã");

		// Not signed in yet: the account page asks for a login.
		expect((await page.browser.request(`${idp.issuer}/account`)).status).toBe(
			303,
		);

		const csrf = formField(review, "csrf");
		await submitForm(page.browser, `${reviewUrl}/unlink/google`, { csrf });
		await submitForm(page.browser, `${reviewUrl}/telegram/unlink`, { csrf });
		const codesPage = await (
			await page.browser.request(`${reviewUrl}/recovery-codes`, {
				form: { csrf },
			})
		).text();
		expect(codesPage.match(/<li><code>/g)).toHaveLength(8);
		const after = await (await page.browser.request(reviewUrl)).text();
		expect(after).not.toContain("intruder@gmail.com");
		expect(after).not.toContain("@intruder_tg");

		const done = await submitForm(
			page.browser,
			`${reviewUrl}/done`,
			{ csrf },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);
		const stored = await repositoryOf(idp).findActiveById(account._id);
		expect(stored?.securityReviewPendingSince).toBeUndefined();
		expect(stored?.providers.google).toBeUndefined();
		expect(stored?.telegram).toBeUndefined();
		expect(stored?.recoveryCodeHashes).toHaveLength(8);
	});

	it("after a reset link, the next sign-in goes through the review", async () => {
		const { account } = await tamperedAccount();
		const token = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
		});
		const owner = new TestBrowser();
		const form = await (
			await owner.request(`${idp.issuer}/reset/${token}`)
		).text();
		await submitForm(owner, `${idp.issuer}/reset/${token}`, {
			csrf: formField(form, "csrf"),
			password: NEW_PASSWORD,
			password_confirm: NEW_PASSWORD,
		});
		const page = await openLoginPage(idp, owner);
		const login = await postLogin(idp, page, account.username, NEW_PASSWORD);
		expect(login.headers.get("location")).toBe(
			`/interaction/${page.uid}/review`,
		);
	});

	it("a live session cannot skip the review, not even silently", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		await repositoryOf(idp).setSecurityReviewPending(account._id, true);
		// An app sign-in that would normally be silent shows the login page.
		const page = await openLoginPage(idp, browser);
		expect(page.html).toContain('name="password"');
		// The account page sends the browser to sign in first.
		const portal = await browser.request(`${idp.issuer}/account`);
		expect(portal.status).toBe(303);
		expect(portal.headers.get("location")).toContain("/auth?");
	});

	it("shows 'không rõ' for links made before identities were recorded", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			providers: { github: "legacy-1" },
		});
		const browser = await signedInBrowser(idp, account);
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		expect(page).toContain("Đã liên kết (không rõ)");
		expect(
			providerDetail({ provider: "github", providerId: "1", login: "octo" }),
		).toMatchObject({ login: "octo" });
	});
});
