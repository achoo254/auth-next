import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountsCollection } from "../accounts/user-model.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("password sign-in is gone", () => {
	it("answers 404 on every former password, sign-up, reset and recovery route", async () => {
		// An account from before, with a password hash still stored.
		const account = await createTestAccount(repositoryOf(idp));
		await accountsCollection(idp.db).updateOne(
			{ _id: account._id },
			{ $set: { passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$legacy" } },
		);
		const page = await openLoginPage(idp);
		const interaction = `${idp.issuer}/interaction/${page.uid}`;
		const posts = [
			`${interaction}/login`,
			`${interaction}/signup`,
			`${interaction}/signup/done`,
			`${interaction}/forgot/recovery`,
			`${interaction}/forgot/telegram`,
			`${interaction}/review/done`,
		];
		for (const url of posts) {
			const response = await page.browser.request(url, {
				form: {
					csrf: page.csrf,
					identifier: account.username,
					password: "anything",
				},
			});
			expect(response.status, url).toBe(404);
		}
		for (const url of [
			`${interaction}/signup`,
			`${interaction}/forgot`,
			`${idp.issuer}/reset/some-old-token`,
			`${idp.issuer}/reset/review`,
		]) {
			expect((await page.browser.request(url)).status, url).toBe(404);
		}
		// The interaction is still waiting for a sign-in: nothing got through.
		const again = await (await page.browser.request(interaction)).text();
		expect(again).toContain(`/interaction/${page.uid}/upstream/google`);
		expect(
			await idp.db
				.collection("oidc_session")
				.countDocuments({ "payload.accountId": account._id }),
		).toBe(0);
	});

	it("/account has no password or recovery-code actions any more", async () => {
		const browser = await signedInBrowser(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		const csrf = formField(page, "csrf");
		for (const path of ["password", "recovery-codes", "recovery-codes/saved"]) {
			const response = await browser.request(`${idp.issuer}/account/${path}`, {
				form: { csrf },
			});
			expect(response.status, path).toBe(404);
		}
	});
});

describe("no Google/GitHub configured", () => {
	it("shows why nobody can sign in instead of an empty page", async () => {
		const bare = await startTestIdp({
			interactions: "real",
			rateLimits: [],
			withoutUpstreams: true,
		});
		try {
			const config = await discoverClient(
				bare,
				STATIC_CLIENT_IDS.localmanWeb,
				client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
			);
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: LOCALMAN_CALLBACK,
				scope: "openid",
				code_challenge: await client.calculatePKCECodeChallenge(
					client.randomPKCECodeVerifier(),
				),
				code_challenge_method: "S256",
			});
			const { response } = await new TestBrowser().navigate(
				url,
				{},
				LOCALMAN_CALLBACK,
			);
			expect(response.status).toBe(503);
			const html = await response.text();
			expect(html).toContain(shown("login.noProvider"));
			expect(html).toContain('data-id="login-cancel"');
			expect(html).not.toContain("/upstream/");
		} finally {
			await bare.close();
		}
	});
});
