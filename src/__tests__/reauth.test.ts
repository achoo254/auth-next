import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { linkedGoogleProfile } from "./helpers/upstream-sign-in.js";

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
	it("asks to sign in with Google again after 10 minutes, then allows the change", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			providers: { google: `g-reauth-${Date.now()}`, github: "5005" },
		});
		await repositoryOf(idp).links.setTelegram(account._id, { chatId: "3003" });
		const browser = await signedInBrowser(idp, account);
		await ageSignIn(account, 11 * 60);
		const csrf = await csrfOf(browser);

		for (const path of [
			"link/google",
			"unlink/github",
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
			(await repositoryOf(idp).findActiveById(account._id))?.providers.github,
		).toBe("5005");

		// Signing in again lands back on /account, with a short notice.
		const challenge = await browser.request(
			`${idp.issuer}/account/unlink/github`,
			{ form: { csrf } },
		);
		const login = await browser.navigate(
			new URL(challenge.headers.get("location") ?? "", idp.issuer),
		);
		const loginPage = await login.response.text();
		expect(loginPage).not.toContain('type="password"');
		const uid = /\/interaction\/([\w-]+)/.exec(login.response.url)?.[1] ?? "";
		idp.fake.nextLogins.push(linkedGoogleProfile(account));
		const back = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
		);
		expect(back.response.url).toBe(`${idp.issuer}/account?notice=reauthed`);
		expect(await back.response.text()).toContain("Đã xác nhận lại danh tính");

		const unlinked = await browser.request(
			`${idp.issuer}/account/unlink/github`,
			{ form: { csrf: await csrfOf(browser) } },
		);
		expect(unlinked.headers.get("location")).toBe("/account?notice=unlinked");
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.providers.github,
		).toBeUndefined();

		// Google is now the only way in: it cannot be unlinked.
		const last = await browser.request(`${idp.issuer}/account/unlink/google`, {
			form: { csrf: await csrfOf(browser) },
		});
		expect(last.headers.get("location")).toBe("/account?notice=last-method");
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.providers.google,
		).toBe(account.providers.google);
	});

	it("tells the owner on Telegram when a provider is linked", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.setTelegram(account._id, { chatId: "3004" });
		const browser = await signedInBrowser(idp, account);
		idp.fake.nextLogins.push({
			id: "3004",
			email: "someone.else@example.com",
			emailVerified: true,
		});
		const linked = await browser.navigate(`${idp.issuer}/account/link/github`, {
			form: { csrf: await csrfOf(browser) },
		});
		expect(linked.response.url).toBe(
			`${idp.issuer}/account?notice=linked-github`,
		);
		await expect
			.poll(() =>
				idp.fake.telegramMessages.some(
					(m) => m.chatId === "3004" && /liên kết với GitHub/.test(m.text),
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
