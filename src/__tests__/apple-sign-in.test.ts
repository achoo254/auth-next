import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appleAnswer, sharedFakeApple } from "./helpers/fake-apple.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type LoginPage,
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const apple = sharedFakeApple();
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { ...FAKE_UPSTREAM_ENV, ...apple.env },
	});
});

afterAll(async () => {
	await idp?.close();
});

/** Login page → "Sign in with Apple" → Apple's authorize URL. */
async function toApple(): Promise<{ page: LoginPage; authorize: URL }> {
	const page = await openLoginPage(idp);
	const { location } = await page.browser.navigate(
		`${idp.issuer}/interaction/${page.uid}/upstream/apple`,
		{},
		"https://appleid.apple.com/",
	);
	if (!location) throw new Error("did not go to Apple");
	return { page, authorize: location };
}

/** Apple's page posts the answer back; the browser follows the redirects. */
function postBack(
	browser: TestBrowser,
	answer: ReturnType<typeof appleAnswer>,
): ReturnType<TestBrowser["navigate"]> {
	return browser.navigate(
		answer.action,
		{ form: answer.form },
		LOCALMAN_CALLBACK,
	);
}

describe("Sign in with Apple", () => {
	it("shows Apple first, as a solid Apple-styled button", async () => {
		const page = await openLoginPage(idp);
		const apple = page.html.indexOf('data-id="upstream-apple"');
		expect(apple).toBeGreaterThan(-1);
		expect(apple).toBeLessThan(page.html.indexOf('data-id="upstream-google"'));
		expect(page.html).toMatch(/class="btn btn-apple btn-block btn-provider"/);
		expect(page.html).toContain("Sign in with Apple");
	});

	it("asks Apple for name and email by form_post, with state and nonce", async () => {
		const { authorize } = await toApple();
		expect(authorize.origin + authorize.pathname).toBe(
			"https://appleid.apple.com/auth/authorize",
		);
		const params = Object.fromEntries(authorize.searchParams);
		expect(params).toMatchObject({
			client_id: apple.env.APPLE_SERVICES_ID,
			redirect_uri: `${idp.issuer}/oauth/apple/callback`,
			response_type: "code",
			response_mode: "form_post",
			scope: "name email",
		});
		expect(params.state).toMatch(/^[\w-]{43}$/);
		expect(params.nonce).toMatch(/^[\w-]{43}$/);
		expect(params).not.toHaveProperty("code_challenge");
	});

	it("signs up with a private relay email and Apple's one-time name", async () => {
		const { page, authorize } = await toApple();
		const answer = appleAnswer(
			authorize,
			{
				sub: "001.relay.1",
				email: "k3x9@privaterelay.appleid.com",
				isPrivateEmail: true,
			},
			{ firstName: "Đạt", lastName: "Trần" },
		);
		const posted = await page.browser.request(answer.action, {
			form: answer.form,
		});
		// The cross-site POST only hands over to a same-site GET: nothing but
		// the state in the URL.
		expect(posted.status).toBe(303);
		expect(posted.headers.get("location")).toBe(
			`/oauth/apple/callback?state=${answer.form.state}`,
		);
		const { response } = await page.browser.navigate(
			new URL(posted.headers.get("location") ?? "", idp.issuer),
			{},
			LOCALMAN_CALLBACK,
		);
		const html = await response.text();
		expect(html).toContain("k3x9@privaterelay.appleid.com");
		const done = await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
			{ form: { csrf: formField(html, "csrf"), username: "apple_user" } },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
		const account = await repositoryOf(idp).findByProvider(
			"apple",
			"001.relay.1",
		);
		expect(account).toMatchObject({
			username: "apple_user",
			email: "k3x9@privaterelay.appleid.com",
			emailVerifiedBy: "apple",
			name: "Đạt Trần",
			providerDetails: {
				apple: {
					email: "k3x9@privaterelay.appleid.com",
					revocationToken: "apple-rt.001.relay.1",
				},
			},
		});
	});

	it("signs in again by Apple id alone: no email, no name", async () => {
		const sub = "001.again.2";
		await createTestAccount(repositoryOf(idp), { providers: { apple: sub } });
		const { page, authorize } = await toApple();
		const done = await postBack(page.browser, appleAnswer(authorize, { sub }));
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
	});

	it("refuses an unknown Apple id that brings no email", async () => {
		const { page, authorize } = await toApple();
		const { response } = await postBack(
			page.browser,
			appleAnswer(authorize, { sub: "001.noemail.3" }),
		);
		expect(response.status).toBe(403);
		expect(await response.text()).toContain("no verified email");
	});

	it("does not match a relay email to an existing account", async () => {
		const existing = await createTestAccount(repositoryOf(idp), {
			emailVerifiedBy: "google",
		});
		const { page, authorize } = await toApple();
		const { response } = await postBack(
			page.browser,
			appleAnswer(authorize, {
				sub: "001.relay.4",
				email: "zz11@privaterelay.appleid.com",
				isPrivateEmail: true,
			}),
		);
		expect(await response.text()).toContain("Choose a username");
		const still = await repositoryOf(idp).findActiveById(existing._id);
		expect(still?.providers.apple).toBeUndefined();
	});

	it("links by a shared real email that Google verified before", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			emailVerifiedBy: "google",
		});
		const { page, authorize } = await toApple();
		const done = await postBack(
			page.browser,
			appleAnswer(authorize, { sub: "001.shared.5", email: account.email }),
		);
		expect(done.location?.searchParams.get("code")).toEqual(expect.any(String));
		const linked = await repositoryOf(idp).findActiveById(account._id);
		expect(linked?.providers.apple).toBe("001.shared.5");
	});

	it("rejects an answer posted to another browser (state cookie missing)", async () => {
		const { authorize } = await toApple();
		const answer = appleAnswer(authorize, {
			sub: "001.csrf.6",
			email: "victim@example.com",
		});
		const other = (await openLoginPage(idp)).browser;
		const { response } = await other.navigate(answer.action, {
			form: answer.form,
		});
		expect(response.status).toBe(410);
		expect(
			await repositoryOf(idp).findByProvider("apple", "001.csrf.6"),
		).toBeUndefined();
	});

	it("rejects a malformed state and a GET without a posted answer", async () => {
		const { page, authorize } = await toApple();
		const bad = await page.browser.request(
			`${idp.issuer}/oauth/apple/callback`,
			{ form: { state: "short", code: "x" } },
		);
		expect(bad.status).toBe(410);
		const state = authorize.searchParams.get("state") ?? "";
		const bare = await page.browser.request(
			`${idp.issuer}/oauth/apple/callback?state=${state}`,
		);
		expect(bare.status).toBe(410);
	});

	it("fails safely on an ID token Apple did not sign", async () => {
		const { page, authorize } = await toApple();
		const { response } = await postBack(
			page.browser,
			appleAnswer(authorize, {
				sub: "001.forged.7",
				email: "f@example.com",
				forgeSignature: true,
			}),
		);
		expect(response.status).toBe(502);
	});

	it("returns to the sign-in page when the person cancels at Apple", async () => {
		const { page, authorize } = await toApple();
		const posted = await page.browser.navigate(
			`${idp.issuer}/oauth/apple/callback`,
			{
				form: {
					state: authorize.searchParams.get("state") ?? "",
					error: "user_cancelled_authorize",
				},
			},
		);
		expect(posted.response.url).toBe(`${idp.issuer}/interaction/${page.uid}`);
	});
});

describe("Apple on /account", () => {
	async function csrfOf(browser: TestBrowser): Promise<string> {
		const page = await browser.request(`${idp.issuer}/account`);
		return formField(await page.text(), "csrf");
	}

	it("links Apple, shows it, then revokes at Apple on unlink", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			emailVerifiedBy: "google",
		});
		const browser = await signedInBrowser(idp, account);
		const started = await browser.request(`${idp.issuer}/account/link/apple`, {
			form: { csrf: await csrfOf(browser) },
		});
		const authorize = new URL(started.headers.get("location") ?? "");
		const linked = await postBack(
			browser,
			appleAnswer(authorize, {
				sub: "001.portal.8",
				email: "p8@privaterelay.appleid.com",
				isPrivateEmail: true,
			}),
		);
		expect(linked.response.url).toBe(
			`${idp.issuer}/account?notice=linked-apple`,
		);
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		expect(page).toContain('data-id="provider-apple"');
		expect(page).toContain("p8@privaterelay.appleid.com");
		expect(page).not.toContain("apple-rt.");

		const unlinked = await browser.navigate(
			`${idp.issuer}/account/unlink/apple`,
			{ form: { csrf: await csrfOf(browser) } },
		);
		expect(unlinked.response.url).toBe(`${idp.issuer}/account?notice=unlinked`);
		expect(apple.revoked).toContain("apple-rt.001.portal.8");
		const after = await repositoryOf(idp).findActiveById(account._id);
		expect(after?.providers.apple).toBeUndefined();
		expect(after?.providerDetails?.apple).toBeUndefined();
	});
});

describe("Apple server-to-server notifications", () => {
	const url = (): string => `${idp.issuer}/oauth/apple/notifications`;
	const post = (body: unknown): Promise<Response> =>
		fetch(url(), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	it("forgets the revocation token when consent is revoked", async () => {
		const sub = "001.notify.9";
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.linkProvider(account, {
			provider: "apple",
			providerId: sub,
			revocationToken: "apple-rt.notify",
		});
		const payload = await apple.sign({
			aud: apple.env.APPLE_SERVICES_ID,
			events: JSON.stringify({ type: "consent-revoked", sub, event_time: 1 }),
		});
		expect((await post({ payload })).status).toBe(200);
		const after = await repositoryOf(idp).findActiveById(account._id);
		expect(after?.providers.apple).toBe(sub);
		expect(after?.providerDetails?.apple?.revocationToken).toBeUndefined();
	});

	it("rejects payloads Apple did not sign, or no payload", async () => {
		const forged = await apple.sign(
			{
				aud: apple.env.APPLE_SERVICES_ID,
				events: { type: "account-deleted", sub: "001.x" },
			},
			true,
		);
		expect((await post({ payload: forged })).status).toBe(400);
		expect((await post({})).status).toBe(400);
	});
});
