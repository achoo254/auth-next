import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHAT_MOBILE_REDIRECT_URI } from "../oidc/chat-clients.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { clientUsageCollection } from "../usage/client-usage-model.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { cliLogin, signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	CHAT_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { linkedGoogleProfile } from "./helpers/upstream-sign-in.js";

/*
 * Every authorization an app receives is recorded once, by the provider's
 * authorization.success listener: "interactive" when the person signed in
 * on the IdP's pages for it, "sso" when a live IdP session let them
 * straight through. A sign-in whose consent is then denied is no
 * authorization and is not recorded.
 */

const CHAT_URL = "http://127.0.0.1:9";
const CHAT_SCOPE = "openid profile email";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { CHAT_WEB_URL: CHAT_URL },
	});
});

afterAll(async () => {
	await idp?.close();
});

async function usageOf(
	account: TestAccount,
): Promise<{ clientId: string; kind: string }[]> {
	return clientUsageCollection(idp.db)
		.find(
			{ tenantId: idp.tenant.id, sub: account._id },
			{ projection: { _id: 0, clientId: 1, kind: 1 } },
		)
		.sort({ at: 1 })
		.toArray();
}

/**
 * The records of `account` once at least `count` have landed and no other
 * write has followed for a while: provider events are not awaited, so an
 * extra (double) record could land after the expected ones.
 */
async function settledUsage(account: TestAccount, count: number) {
	await expect
		.poll(async () => (await usageOf(account)).length)
		.toBeGreaterThanOrEqual(count);
	let records = await usageOf(account);
	for (let reads = 0; reads < 20; reads += 1) {
		await new Promise((resolve) => setTimeout(resolve, 250));
		const again = await usageOf(account);
		if (again.length === records.length) return again;
		records = again;
	}
	throw new Error("client usage kept changing");
}

/** The uid of the interaction page `page` shows. */
function interactionUid(page: Response): string {
	const uid = /\/interaction\/([\w-]+)/.exec(page.url)?.[1];
	if (!uid) throw new Error(`not on an interaction page: ${page.status}`);
	return uid;
}

/** Approves (consent) or denies (abort) a native app's approval page. */
async function answerNativeApp(
	browser: TestBrowser,
	page: Response,
	answer: "consent" | "abort",
): Promise<URL> {
	const back = await submitForm(
		browser,
		`${idp.issuer}/interaction/${interactionUid(page)}/${answer}`,
		{ csrf: formField(await page.text(), "csrf") },
		CHAT_MOBILE_REDIRECT_URI,
	);
	if (!back.location) throw new Error("did not return to the app");
	return back.location;
}

/** chat-mobile's sign-in page signed in with `account`: its approval page. */
async function signInToChatMobile(
	browser: TestBrowser,
	account: TestAccount,
): Promise<Response> {
	const { response: login } = await browser.navigate(
		await chatMobileAuthorization(),
		{},
		CHAT_MOBILE_REDIRECT_URI,
	);
	idp.fake.nextLogins.push(linkedGoogleProfile(account));
	const { response: approval } = await browser.navigate(
		`${idp.issuer}/interaction/${interactionUid(login)}/upstream/google`,
		{},
		CHAT_MOBILE_REDIRECT_URI,
	);
	return approval;
}

async function chatMobileAuthorization(): Promise<URL> {
	const config = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.chatMobile,
		client.None(),
	);
	return client.buildAuthorizationUrl(config, {
		redirect_uri: CHAT_MOBILE_REDIRECT_URI,
		scope: CHAT_SCOPE,
		code_challenge: await client.calculatePKCECodeChallenge(
			client.randomPKCECodeVerifier(),
		),
		code_challenge_method: "S256",
	});
}

describe("client usage of sign-ins", () => {
	it("counts a sign-in once, then each app reached with the IdP session once", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		expect(await settledUsage(account, 1)).toEqual([
			{ clientId: STATIC_CLIENT_IDS.localmanWeb, kind: "interactive" },
		]);

		const chatWeb = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.chatWeb,
			client.ClientSecretBasic(CHAT_WEB_SECRET),
		);
		await codeTokens(chatWeb, browser, `${CHAT_URL}/auth/callback`, CHAT_SCOPE);
		const { response } = await browser.navigate(
			await chatMobileAuthorization(),
			{},
			CHAT_MOBILE_REDIRECT_URI,
		);
		await answerNativeApp(browser, response, "consent");
		await cliLogin(idp, browser);

		expect(await settledUsage(account, 4)).toEqual([
			{ clientId: STATIC_CLIENT_IDS.localmanWeb, kind: "interactive" },
			{ clientId: STATIC_CLIENT_IDS.chatWeb, kind: "sso" },
			{ clientId: STATIC_CLIENT_IDS.chatMobile, kind: "sso" },
			{ clientId: STATIC_CLIENT_IDS.tuneloCli, kind: "sso" },
		]);
	});

	it("counts a sign-in followed by an approval page once", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = new TestBrowser();
		const approval = await signInToChatMobile(browser, account);
		await answerNativeApp(browser, approval, "consent");

		expect(await settledUsage(account, 1)).toEqual([
			{ clientId: STATIC_CLIENT_IDS.chatMobile, kind: "interactive" },
		]);
	});

	it("does not count a sign-in whose approval is then denied", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = new TestBrowser();
		const approval = await signInToChatMobile(browser, account);
		const back = await answerNativeApp(browser, approval, "abort");
		expect(back.searchParams.get("error")).toBe("access_denied");

		expect(await settledUsage(account, 0)).toEqual([]);
	});

	it("counts a device sign-in on the IdP's pages once, as interactive", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await cliLogin(idp, new TestBrowser(), account);

		expect(await settledUsage(account, 1)).toEqual([
			{ clientId: STATIC_CLIENT_IDS.tuneloCli, kind: "interactive" },
		]);
	});
});
