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
 * Every authorization an app receives is recorded once: as "interactive"
 * when the person signed in on the IdP's pages for it (finishLogin), as
 * "sso" when a live IdP session let them straight through
 * (authorization.success). oidc-provider emits authorization.success for
 * the interactive case too, after the login and any consent step.
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

/** Waits until `account` has `count` records (provider events are not awaited). */
async function settledUsage(account: TestAccount, count: number) {
	await expect.poll(async () => (await usageOf(account)).length).toBe(count);
	return usageOf(account);
}

/** The approval page of a native app, then back to the app. */
async function approveNativeApp(
	browser: TestBrowser,
	page: Response,
): Promise<void> {
	const uid = /\/interaction\/([\w-]+)/.exec(page.url)?.[1];
	if (!uid) throw new Error(`no approval page: ${page.status}`);
	const back = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/consent`,
		{ csrf: formField(await page.text(), "csrf") },
		CHAT_MOBILE_REDIRECT_URI,
	);
	if (!back.location) throw new Error("did not return to the app");
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
		await approveNativeApp(browser, response);
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
		const { response: login } = await browser.navigate(
			await chatMobileAuthorization(),
			{},
			CHAT_MOBILE_REDIRECT_URI,
		);
		const uid = /\/interaction\/([\w-]+)/.exec(login.url)?.[1];
		if (!uid) throw new Error(`not on the sign-in page: ${login.url}`);
		idp.fake.nextLogins.push(linkedGoogleProfile(account));
		const { response: approval } = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
			{},
			CHAT_MOBILE_REDIRECT_URI,
		);
		await approveNativeApp(browser, approval);

		// Let a stray authorization.success write land before counting.
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(await settledUsage(account, 1)).toEqual([
			{ clientId: STATIC_CLIENT_IDS.chatMobile, kind: "interactive" },
		]);
	});
});
