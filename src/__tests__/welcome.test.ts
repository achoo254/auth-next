import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	originAppOf,
	renderWelcome,
	welcomeSuggestion,
} from "../interactions/welcome-page.js";
import {
	accountIosConfig,
	iosCallbackOf,
} from "./helpers/account-ios-flows.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
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
	it("suggests the app paired with the origin once, then Back finishes the sign-in", async () => {
		const { page, welcomeUrl, html } = await signUpToWelcome(
			"g-welcome-1",
			"welcome_one",
		);
		const account = await repositoryOf(idp).findByProvider(
			"google",
			"g-welcome-1",
		);
		expect(account?.username).toBe("welcome_one");
		expect(account?.welcomedAt).toBeInstanceOf(Date);
		expect(html).toContain("You&#39;re in. Welcome aboard!");
		// Localman is paired with no app: Web Nhanh, the fallback, is the one card.
		expect(html.match(/data-id="welcome-open-/g)).toHaveLength(1);
		expect(html).toContain(
			`href="${WEBNHANH_WEB_URL}/?utm_source=cross_sell&amp;utm_medium=welcome&amp;utm_campaign=localman" target="_blank" rel="noopener noreferrer" data-id="welcome-open-webnhanh"`,
		);
		expect(html).toContain("If you like Localman");
		expect(html).toContain("Back to Localman");
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
		// The finished interaction shows no welcome page any more.
		const again = await page.browser.request(welcomeUrl);
		expect(again.status).not.toBe(200);
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
		const suggestion = welcomeSuggestion(idp.tenant, undefined);
		if (!suggestion) throw new Error("no suggestion");
		const html = renderWelcome({
			page: testPage("vi"),
			uid: "uid-1",
			csrf: "token",
			suggestion,
		});
		expect(html).toContain(">Tiếp tục</button>");
		expect(html).not.toContain("Quay lại");
		expect(html).toContain("Xong rồi, chào bạn mới nha!");
		expect(html).toContain("Gợi ý cho bạn");
		expect(html).toContain("utm_campaign=auth");
	});

	it("goes back to the origin app by name, in Vietnamese", () => {
		const suggestion = welcomeSuggestion(idp.tenant, "tuvi-web");
		if (!suggestion) throw new Error("no suggestion");
		const html = renderWelcome({
			page: testPage("vi"),
			uid: "uid-1",
			csrf: "token",
			suggestion,
			clientName: "Tử Vi",
		});
		expect(html).toContain(">Quay lại Tử Vi</button>");
		expect(html).toContain("Đã thích Tử Vi");
		expect(html).toContain('data-id="welcome-open-webnhanh"');
	});

	it("suggests the shared pairing of the app the account came from", () => {
		const suggested = (clientId: string | undefined) =>
			welcomeSuggestion(idp.tenant, clientId)?.key;
		// The shared table still pairs Tử Vi with Truyện, which is no longer listed: the fallback applies.
		expect(suggested("tuvi-web")).toBe("webnhanh");
		expect(suggested("webnhanh-web")).toBe("kb");
		expect(suggested("miu-web")).toBe("chuanho");
		expect(suggested("chat-web")).toBe("clip");
		expect(suggested("clip-web")).toBe("tuvi");
		expect(suggested("kb-web")).toBe("webnhanh");
		expect(suggested("chuanho-web")).toBe("miu");
		expect(suggested("localman-web")).toBe("webnhanh");
		expect(suggested("hoandat-account")).toBe("webnhanh");
		expect(welcomeSuggestion(idp.tenant, "tuvi-web")?.href).toBe(
			"https://webnhanh.hoandat.com/?utm_source=cross_sell&utm_medium=welcome&utm_campaign=tuvi",
		);
	});

	it("maps clients to their app, the IdP itself to none", () => {
		expect(originAppOf("tuvi-web")).toBe("tuvi");
		expect(originAppOf("kb-web-dev")).toBe("kb");
		expect(originAppOf("hoandat-account")).toBeUndefined();
		expect(originAppOf("")).toBeUndefined();
		expect(originAppOf(undefined)).toBeUndefined();
	});

	it("falls back to Web Nhanh, then the first configured app, never the origin", () => {
		const webApps = idp.tenant.webApps;
		expect(
			welcomeSuggestion(
				{ webApps: { ...webApps, kb: undefined } },
				"webnhanh-web",
			)?.key,
		).toBe("scribe");
		const onlyTuvi = {
			localman: webApps.localman,
			tunelo: webApps.tunelo,
			chat: webApps.chat,
			tuvi: webApps.tuvi,
		};
		expect(
			welcomeSuggestion({ webApps: onlyTuvi }, "tuvi-web"),
		).toBeUndefined();
		expect(welcomeSuggestion({ webApps: onlyTuvi }, "chat-web")?.key).toBe(
			"tuvi",
		);
	});
});

describe("welcome flag on the account", () => {
	it("is set once: a second try says the account was welcomed already", async () => {
		const repository = repositoryOf(idp);
		const account = await createTestAccount(repository);
		expect(await repository.markWelcomed(account._id)).toBe(true);
		expect(await repository.markWelcomed(account._id)).toBe(false);
	});
});

describe("welcome screen switched off", () => {
	it("sends a new account straight back to the app", async () => {
		const off = await startTestIdp({
			interactions: "real",
			rateLimits: [],
			env: { ...FAKE_UPSTREAM_ENV, WELCOME_PAGE_ENABLED: "false" },
		});
		try {
			const { page, response } = await signInWith(off, "google", {
				id: "g-welcome-off",
				email: "welcome_off@example.com",
				emailVerified: true,
			});
			const posted = await page.browser.request(
				`${off.issuer}/interaction/${page.uid}/upstream/signup`,
				{
					form: {
						csrf: formField(await response.text(), "csrf"),
						username: "welcome_off",
					},
				},
			);
			expect(posted.status).toBe(303);
			expect(posted.headers.get("location")).not.toContain("/welcome");
			const account = await repositoryOf(off).findByProvider(
				"google",
				"g-welcome-off",
			);
			expect(account?.welcomedAt).toBeUndefined();
		} finally {
			await off.close();
		}
	});
});

describe("welcome flag that cannot be written", () => {
	it("finishes the sign-in back to the app instead of failing", async () => {
		const failing = vi
			.spyOn(repositoryOf(idp), "markWelcomed")
			.mockRejectedValueOnce(new Error("mongo down"));
		try {
			const { page, response } = await signInWith(idp, "google", {
				id: "g-welcome-flag-error",
				email: "welcome_flag_error@example.com",
				emailVerified: true,
			});
			const posted = await page.browser.request(
				`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
				{
					form: {
						csrf: formField(await response.text(), "csrf"),
						username: "welcome_flag_error",
					},
				},
			);
			expect(posted.status).toBe(303);
			expect(posted.headers.get("location")).not.toContain("/welcome");
			expect(failing).toHaveBeenCalledOnce();
			const account = await repositoryOf(idp).findByProvider(
				"google",
				"g-welcome-flag-error",
			);
			expect(await loginsOf(account?._id)).toEqual([
				{ methods: ["fed", "google"] },
			]);
		} finally {
			failing.mockRestore();
		}
	});
});
