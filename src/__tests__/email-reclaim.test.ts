import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import {
	TEST_PASSWORD,
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

describe("emails from Google/GitHub", () => {
	it("lets the verified owner reclaim an email squatted by an unverified account", async () => {
		// P6: someone registered the victim's address first, with a password.
		const accounts = repositoryOf(idp);
		const squatter = await createTestAccount(accounts, {
			email: "Victim.Name@Gmail.com",
		});
		await accounts.links.setTelegram(squatter._id, { chatId: "6006" });
		const { page, response } = await signInWith(idp, fake, "github", {
			id: "300",
			email: "victim.name@gmail.com",
			emailVerified: true,
			name: "Victim",
		});
		const html = await response.text();
		expect(html).toContain("Chọn username");
		expect(html).toContain("chưa ai xác minh");
		expect(html).not.toContain(squatter.username);
		const done = await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
			{ form: { csrf: formField(html, "csrf"), username: "real_victim" } },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);

		const owner = await accounts.findByProvider("github", "300");
		expect(owner).toMatchObject({
			username: "real_victim",
			email: "victim.name@gmail.com",
			emailVerifiedBy: "github",
		});
		expect(owner?._id).not.toBe(squatter._id);
		const old = await accounts.findActiveById(squatter._id);
		expect(old?.email).toBeUndefined();
		expect(old?.providers.github).toBeUndefined();
		expect(old?.reclaimedEmail?.email).toBe("victim.name@gmail.com");
		await expect
			.poll(() =>
				fake.telegramMessages.some(
					(m) => m.chatId === "6006" && /đã được gỡ/.test(m.text),
				),
			)
			.toBe(true);

		// The old account still signs in by username and sees why on /account.
		const login = await openLoginPage(idp);
		const back = await login.browser.navigate(
			`${idp.issuer}/interaction/${login.uid}/login`,
			{
				form: {
					csrf: login.csrf,
					identifier: squatter.username,
					password: TEST_PASSWORD,
				},
			},
			LOCALMAN_CALLBACK,
		);
		expect(back.location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);
		const accountPage = await (
			await login.browser.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain('data-id="account-email-reclaimed"');
		expect(accountPage).toContain("Chưa có email");
	});

	it("stores a Google email normalised", async () => {
		const { page, response } = await signInWith(idp, fake, "google", {
			id: "g-mixed",
			email: "Mixed.Case@Example.com",
			emailVerified: true,
		});
		const done = await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
			{
				form: {
					csrf: formField(await response.text(), "csrf"),
					username: "mixed_case",
				},
			},
			LOCALMAN_CALLBACK,
		);
		expect(done.location).toBeDefined();
		const account = await repositoryOf(idp).findByProvider("google", "g-mixed");
		expect(account?.email).toBe("mixed.case@example.com");
		expect(
			(await repositoryOf(idp).findByIdentifier("MIXED.CASE@example.com"))?._id,
		).toBe(account?._id);
	});

	it("says which field is taken when choosing a username", async () => {
		const existing = await createTestAccount(repositoryOf(idp));
		const { page, response } = await signInWith(idp, fake, "google", {
			id: "g-taken",
			email: "someone.new@example.com",
			emailVerified: true,
		});
		const retry = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/upstream/signup`,
			{
				form: {
					csrf: formField(await response.text(), "csrf"),
					username: existing.username,
				},
			},
		);
		expect(retry.status).toBe(409);
		expect(await retry.text()).toContain("Username này đã có người dùng");
	});
});
