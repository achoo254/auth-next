import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
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

/** Pretends the browser's sign-in happened `seconds` ago. */
async function ageSignIn(account: TestAccount, seconds: number): Promise<void> {
	await idp.db
		.collection(collectionNameFor("Session"))
		.updateMany(
			{ "payload.accountId": account._id },
			{ $inc: { "payload.loginTs": -seconds } },
		);
}

async function csrfOf(browser: TestBrowser): Promise<string> {
	return formField(
		await (await browser.request(`${idp.issuer}/account`)).text(),
		"csrf",
	);
}

describe("sensitive changes need a recent sign-in", () => {
	it("asks for the password again after 10 minutes, then allows the change", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.setTelegram(account._id, { chatId: "3003" });
		const browser = await signedInBrowser(idp, account);
		await ageSignIn(account, 11 * 60);
		const csrf = await csrfOf(browser);

		for (const path of [
			"recovery-codes",
			"password",
			"link/google",
			"unlink/google",
			"telegram/link",
			"telegram/unlink",
		]) {
			const response = await browser.request(`${idp.issuer}/account/${path}`, {
				form: { csrf },
			});
			expect(response.status, path).toBe(303);
			const location = new URL(
				response.headers.get("location") ?? "",
				idp.issuer,
			);
			expect(location.pathname, path).toBe("/auth");
			expect(location.searchParams.get("prompt"), path).toBe("login");
		}
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.recoveryCodeHashes,
		).toEqual([]);

		// Signing in again lands back on /account, with a short notice.
		const challenge = await browser.request(
			`${idp.issuer}/account/recovery-codes`,
			{ form: { csrf } },
		);
		const login = await browser.navigate(
			new URL(challenge.headers.get("location") ?? "", idp.issuer),
		);
		const loginPage = await login.response.text();
		expect(loginPage).toContain('name="password"');
		const uid = /\/interaction\/([\w-]+)/.exec(login.response.url)?.[1] ?? "";
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/login`,
			{
				csrf: formField(loginPage, "csrf"),
				identifier: account.username,
				password: TEST_PASSWORD,
			},
		);
		expect(back.response.url).toBe(`${idp.issuer}/account?notice=reauthed`);
		expect(await back.response.text()).toContain("Đã xác nhận lại danh tính");

		const codes = await browser.request(
			`${idp.issuer}/account/recovery-codes`,
			{ form: { csrf: await csrfOf(browser) } },
		);
		expect(codes.status).toBe(200);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.recoveryCodeHashes,
		).toHaveLength(8);
		await expect
			.poll(() =>
				fake.telegramMessages.some(
					(m) => m.chatId === "3003" && /mã khôi phục mới/.test(m.text),
				),
			)
			.toBe(true);
	});

	it("tells the owner on Telegram when the password changes", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.setTelegram(account._id, { chatId: "3004" });
		const browser = await signedInBrowser(idp, account);
		await submitForm(browser, `${idp.issuer}/account/password`, {
			csrf: await csrfOf(browser),
			current_password: TEST_PASSWORD,
			password: "another-password",
			password_confirm: "another-password",
		});
		await expect
			.poll(() =>
				fake.telegramMessages.some(
					(m) => m.chatId === "3004" && /vừa được đổi/.test(m.text),
				),
			)
			.toBe(true);
	});

	it("shows the 'confirmed again' notice only for this browser's own state", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const forged = await browser.request(
			`${idp.issuer}/account/callback?code=x&state=reauth.forged-nonce`,
		);
		expect(forged.headers.get("location")).toBe("/account");
		const stranger = await browser.request(
			`${idp.issuer}/account/callback?code=x&state=reauth.`,
		);
		expect(stranger.headers.get("location")).toBe("/account");
	});
});
