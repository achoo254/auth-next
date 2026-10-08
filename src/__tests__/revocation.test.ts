import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

const NEW_PASSWORD = "brand-new-password";

describe("a password reset signs the account out everywhere", () => {
	it("through a reset link (Telegram or Google/GitHub)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const other = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, other);
		const token = await createPasswordResetToken(idp.services.accountTokens, {
			accountId: account._id,
		});

		const resetter = new TestBrowser();
		const form = await (
			await resetter.request(`${idp.issuer}/reset/${token}`)
		).text();
		expect(form).toContain(`@${account.username}`);
		const done = await submitForm(resetter, `${idp.issuer}/reset/${token}`, {
			csrf: formField(form, "csrf"),
			password: NEW_PASSWORD,
			password_confirm: NEW_PASSWORD,
		});
		expect(await done.response.text()).toContain("Rà soát bảo mật");

		expect(await accountPageStatus(idp, other)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("through a recovery code", async () => {
		const { codes, hashes } = await generateRecoveryCodes();
		const account = await createTestAccount(repositoryOf(idp), {
			recoveryCodeHashes: [...hashes],
		});
		const other = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, other);

		const page = await openLoginPage(idp);
		const reset = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/forgot/recovery`,
			{
				form: {
					csrf: page.csrf,
					identifier: account.email,
					code: codes[0] ?? "",
					password: NEW_PASSWORD,
					password_confirm: NEW_PASSWORD,
				},
			},
		);
		expect(reset.status).toBe(303);

		expect(await accountPageStatus(idp, other)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});
});

describe("changing the password on /account", () => {
	async function changePassword(
		browser: TestBrowser,
		everywhere: boolean,
	): Promise<string> {
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		expect(page).toContain('name="logout_everywhere" value="yes" checked');
		const done = await submitForm(browser, `${idp.issuer}/account/password`, {
			csrf: formField(page, "csrf"),
			current_password: TEST_PASSWORD,
			password: NEW_PASSWORD,
			password_confirm: NEW_PASSWORD,
			...(everywhere ? { logout_everywhere: "yes" } : {}),
		});
		return done.response.text();
	}

	it("signs other browsers out and, by default, every device and app", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const current = await signedInBrowser(idp, account);
		const other = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, other);
		expect(await changePassword(current, true)).toContain("Đã đổi mật khẩu");
		expect(await accountPageStatus(idp, current)).toBe(200);
		expect(await accountPageStatus(idp, other)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("keeps devices and apps when the box is unticked", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const current = await signedInBrowser(idp, account);
		const other = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, other);
		await changePassword(current, false);
		expect(await accountPageStatus(idp, other)).toBe(303);
		const refreshed = await client.refreshTokenGrant(
			cli.config,
			cli.refreshToken,
		);
		expect(refreshed.access_token).toEqual(expect.any(String));
	});
});
