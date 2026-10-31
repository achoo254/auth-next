import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { heroApps, renderWelcome } from "../interactions/welcome-page.js";
import {
	accountIosConfig,
	iosCallbackOf,
} from "./helpers/account-ios-flows.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	TUVI_WEB_URL,
	type TestIdp,
	WEBNHANH_WEB_URL,
	startTestIdp,
} from "./helpers/test-idp.js";
import { testPage } from "./helpers/test-page.js";
import { linkedGoogleProfile, signInWith } from "./helpers/upstream-sign-in.js";

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

async function loginsOf(accountId: string | undefined): Promise<unknown[]> {
	const events = await auditOutboxCollection(idp.db)
		.find({ sub: accountId, type: "login.succeeded" })
		.toArray();
	return events.map((event) => event.data);
}

/** A brand-new Google identity up to the welcome screen. */
async function signUpToWelcome(id: string, username: string) {
	const { page, response } = await signInWith(idp, "google", {
		id,
		email: `${username}@example.com`,
		emailVerified: true,
	});
	const posted = await page.browser.request(
		`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
		{ form: { csrf: formField(await response.text(), "csrf"), username } },
	);
	expect(posted.status).toBe(303);
	expect(posted.headers.get("location")).toBe(
		`/interaction/${page.uid}/welcome`,
	);
	const welcomeUrl = `${idp.issuer}/interaction/${page.uid}/welcome`;
	const welcome = await page.browser.request(welcomeUrl);
	expect(welcome.status).toBe(200);
	return { page, welcomeUrl, html: await welcome.text() };
}

describe("welcome screen of a new account", () => {
	it("shows the hero apps once, then Continue finishes the sign-in", async () => {
		const { page, welcomeUrl, html } = await signUpToWelcome(
			"g-welcome-1",
			"welcome_one",
		);
		const account = await repositoryOf(idp).findByProvider(
			"google",
			"g-welcome-1",
		);
		expect(account?.username).toBe("welcome_one");
		expect(html).toContain("Welcome to hoandat.com");
		for (const [key, href] of [
			["tuvi", TUVI_WEB_URL],
			["miu", idp.tenant.webApps.miu ?? "missing"],
			["webnhanh", WEBNHANH_WEB_URL],
		]) {
			expect(html).toContain(
				`href="${href}" target="_blank" rel="noopener noreferrer" data-id="welcome-open-${key}"`,
			);
		}
		expect(html).toContain("Continue to Localman");
		// Not signed in yet: the sign-in finishes only through the button.
		expect(await loginsOf(account?._id)).toEqual([]);

		const done = await page.browser.navigate(
			welcomeUrl,
			{ form: { csrf: formField(html, "csrf") } },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
		expect(await loginsOf(account?._id)).toEqual([
			{ methods: ["fed", "google"] },
		]);
	});

	it("rejects Continue without the form's CSRF token, and keeps the sign-in", async () => {
		const { page, welcomeUrl, html } = await signUpToWelcome(
			"g-welcome-2",
			"welcome_two",
		);
		for (const form of [{}, { csrf: "forged" }] as Record<string, string>[]) {
			const refused = await page.browser.request(welcomeUrl, { form });
			expect(refused.status).toBe(403);
		}
		const account = await repositoryOf(idp).findByProvider(
			"google",
			"g-welcome-2",
		);
		expect(await loginsOf(account?._id)).toEqual([]);
		const done = await page.browser.navigate(
			welcomeUrl,
			{ form: { csrf: formField(html, "csrf") } },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
	});

	it("is skipped for an existing account, and its URL holds no sign-in", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const { location } = await signInWith(
			idp,
			"google",
			linkedGoogleProfile(account),
		);
		expect(location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);

		const { page } = await signInWith(idp, "google", {
			id: "g-welcome-unused",
			email: "unused@example.com",
			emailVerified: true,
		});
		const welcomeUrl = `${idp.issuer}/interaction/${page.uid}/welcome`;
		const shown = await page.browser.request(welcomeUrl);
		expect(shown.status).toBe(303);
		expect(shown.headers.get("location")).toBe(`/interaction/${page.uid}`);
		const pressed = await page.browser.request(welcomeUrl, {
			form: { csrf: page.csrf },
		});
		expect(pressed.status).toBe(303);
		expect(pressed.headers.get("location")).toBe(`/interaction/${page.uid}`);
	});
});

describe("welcome screen in our phone apps", () => {
	it("is skipped: the in-app sign-in sheet finishes at once", async () => {
		const browser = new TestBrowser();
		const url = client.buildAuthorizationUrl(await accountIosConfig(idp), {
			redirect_uri: iosCallbackOf(idp),
			scope: "openid",
			code_challenge: await client.calculatePKCECodeChallenge(
				client.randomPKCECodeVerifier(),
			),
			code_challenge_method: "S256",
		});
		const login = await browser.navigate(url, {}, iosCallbackOf(idp));
		const uid = /\/interaction\/([\w-]+)/.exec(login.response.url)?.[1] ?? "";
		idp.fake.nextLogins.push({
			id: "g-welcome-ios",
			email: "welcome_ios@example.com",
			emailVerified: true,
		});
		const chosen = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
		);
		const posted = await browser.request(
			`${idp.issuer}/interaction/${uid}/upstream/signup`,
			{
				form: {
					csrf: formField(await chosen.response.text(), "csrf"),
					username: "welcome_ios",
				},
			},
		);
		expect(posted.status).toBe(303);
		expect(posted.headers.get("location")).not.toContain("/welcome");
		const account = await repositoryOf(idp).findByProvider(
			"google",
			"g-welcome-ios",
		);
		expect(await loginsOf(account?._id)).toEqual([
			{ methods: ["fed", "google"] },
		]);
	});
});

describe("welcome page", () => {
	it("says a neutral Continue when the app has no name to show", () => {
		const html = renderWelcome({
			page: testPage("vi"),
			uid: "uid-1",
			csrf: "token",
			apps: heroApps(idp.tenant),
		});
		expect(html).toContain(">Tiếp tục</button>");
		expect(html).not.toContain("Tiếp tục vào");
		expect(html).toContain("Chào mừng đến với hoandat.com");
	});

	it("lists only the hero apps the tenant configured", () => {
		expect(
			heroApps({
				webApps: { ...idp.tenant.webApps, miu: undefined, tuvi: undefined },
			}).map((app) => app.key),
		).toEqual(["webnhanh"]);
	});
});
