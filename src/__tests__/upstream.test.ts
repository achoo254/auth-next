import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FAKE_UPSTREAM_ENV,
	type FakeProfile,
	FakeUpstreams,
} from "./helpers/fake-upstreams.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { signInWith } from "./helpers/upstream-sign-in.js";

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

function signIn(
	provider: "google" | "github",
	profile: FakeProfile,
	query = "",
): ReturnType<typeof signInWith> {
	return signInWith(idp, fake, provider, profile, query);
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
		expect(html).toContain("Chọn username");
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
		expect(account?.passwordHash).toBeUndefined();
	});

	it("links automatically when the account's email was already verified", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			emailVerifiedBy: "github",
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
		expect(await response.text()).toContain("chưa có email đã xác minh");
		expect(
			await repositoryOf(idp).findByProvider("github", "301"),
		).toBeUndefined();
	});

	it("lets a linked Google account set a new password (forgot password)", async () => {
		const account = await createTestAccount(repositoryOf(idp), {
			providers: { google: "g-400" },
			emailVerifiedBy: "google",
		});
		const { page, response } = await signIn(
			"google",
			{ id: "g-400", email: account.email, emailVerified: true },
			"?purpose=reset",
		);
		const html = await response.text();
		expect(new URL(response.url).pathname).toMatch(/^\/reset\/[\w-]{43}$/);
		const reset = await page.browser.navigate(response.url, {
			form: {
				csrf: formField(html, "csrf"),
				password: "brand-new-pass",
				password_confirm: "brand-new-pass",
			},
		});
		expect(await reset.response.text()).toContain("Rà soát bảo mật");
		const replay = await page.browser.request(response.url);
		expect(replay.status).toBe(410);
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
