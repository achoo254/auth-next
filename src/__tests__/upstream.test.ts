import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountsCollection } from "../accounts/user-model.js";
import { localmanWeb } from "./helpers/exchange-flows.js";
import {
	FAKE_UPSTREAM_ENV,
	type FakeProfile,
} from "./helpers/fake-upstreams.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { signInWith } from "./helpers/upstream-sign-in.js";

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

function signIn(
	provider: "google" | "github",
	profile: FakeProfile,
): ReturnType<typeof signInWith> {
	return signInWith(idp, provider, profile);
}

describe("Google and GitHub sign-in", () => {
	it("creates an account with a verified email after choosing a username", async () => {
		const { page, response } = await signIn("google", {
			id: "g-100",
			email: "new.person@gmail.com",
			emailVerified: true,
			name: "New Person",
		});
		const html = await response.text();
		expect(html).toContain("Choose a username");
		expect(html).toContain('value="new_person"');
		const done = await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
			{
				form: { csrf: formField(html, "csrf"), username: "new_person" },
			},
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
		const account = await repositoryOf(idp).findByProvider("google", "g-100");
		expect(account).toMatchObject({
			username: "new_person",
			email: "new.person@gmail.com",
			emailVerifiedBy: "google",
			name: "New Person",
		});
		expect(account).not.toHaveProperty("passwordHash");
		expect(account).not.toHaveProperty("recoveryCodeHashes");
	});

	it("signs up through Google from the prompt=create page", async () => {
		const browser = new TestBrowser();
		const url = client.buildAuthorizationUrl(await localmanWeb(idp), {
			redirect_uri: LOCALMAN_CALLBACK,
			scope: "openid",
			prompt: "create",
			code_challenge: await client.calculatePKCECodeChallenge(
				client.randomPKCECodeVerifier(),
			),
			code_challenge_method: "S256",
		});
		const start = await browser.navigate(url, {}, LOCALMAN_CALLBACK);
		const uid = /\/interaction\/([\w-]+)/.exec(start.response.url)?.[1] ?? "";
		expect(await start.response.text()).toContain(
			`/interaction/${uid}/upstream/google`,
		);
		idp.fake.nextLogins.push({
			id: "g-create",
			email: "created.here@gmail.com",
			emailVerified: true,
		});
		const chosen = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
			{},
			LOCALMAN_CALLBACK,
		);
		const html = await chosen.response.text();
		expect(html).toContain("Choose a username");
		const done = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/signup`,
			{ form: { csrf: formField(html, "csrf"), username: "created_here" } },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
		expect(
			await repositoryOf(idp).findByProvider("google", "g-create"),
		).toMatchObject({ username: "created_here" });
	});

	it("links automatically when the account's email was already verified", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			emailVerifiedBy: "github",
			providers: { github: "6006" },
		});
		const { location } = await signIn("google", {
			id: "g-200",
			email: account.email,
			emailVerified: true,
		});
		expect(location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.providers.google,
		).toBe("g-200");
	});

	it("refuses a provider account whose email is not verified", async () => {
		const { response } = await signIn("github", {
			id: "301",
			email: "unverified@example.com",
			emailVerified: false,
		});
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("has no verified email");
		expect(
			await repositoryOf(idp).findByProvider("github", "301"),
		).toBeUndefined();
	});

	it("signs in an older account despite a review flag left by the old password reset", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			providers: { google: "g-400" },
			emailVerifiedBy: "google",
		});
		await accountsCollection(idp.db).updateOne(
			{ _id: account._id },
			{
				$set: {
					securityReviewPendingSince: new Date(),
					passwordHash: "$argon2id$legacy",
				},
			},
		);
		const { location } = await signIn("google", {
			id: "g-400",
			email: account.email,
			emailVerified: true,
		});
		expect(location?.searchParams.get("code")).toEqual(expect.any(String));
	});
});

describe("unknown or disabled providers", () => {
	it("answers 404 for a provider that is not configured", async () => {
		const page = await openLoginPage(idp);
		const response = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/upstream/facebook`,
		);
		expect(response.status).toBe(404);
		expect((await fetch(`${idp.issuer}/oauth/facebook/callback`)).status).toBe(
			404,
		);
	});
});
