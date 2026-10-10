import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
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

describe("emails from Google/GitHub", () => {
	it("lets the verified owner reclaim an email squatted by an unverified account", async () => {
		// An older account holds the victim's address, never verified.
		const accounts = repositoryOf(idp);
		const squatter = await createTestAccount(accounts, {
			email: "Victim.Name@Gmail.com",
		});
		await accounts.links.setTelegram(squatter._id, { chatId: "6006" });
		const { page, response } = await signInWith(idp, "github", {
			id: "300",
			email: "victim.name@gmail.com",
			emailVerified: true,
			name: "Victim",
		});
		const html = await response.text();
		expect(html).toContain("Choose a username");
		expect(html).toContain("that nobody has verified");
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
				idp.fake.telegramMessages.some(
					// No language stored with the link: English.
					(m) =>
						m.chatId === "6006" &&
						/was removed from hoandat account/.test(m.text),
				),
			)
			.toBe(true);

		// The old account still signs in with its own Google and sees why on /account.
		const browser = await signedInBrowser(idp, squatter);
		const accountPage = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain('data-id="account-email-reclaimed"');
		expect(accountPage).toContain("No email yet");
	});

	it("stores a Google email normalised", async () => {
		const { page, response } = await signInWith(idp, "google", {
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
			(await repositoryOf(idp).findByEmail("MIXED.CASE@example.com"))?._id,
		).toBe(account?._id);
	});

	it("says which field is taken when choosing a username", async () => {
		const existing = await createTestAccount(repositoryOf(idp));
		const { page, response } = await signInWith(idp, "google", {
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
		expect(await retry.text()).toContain("This username is taken");
	});
});
