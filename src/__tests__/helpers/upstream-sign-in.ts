import { expect } from "vitest";
import type { FakeProfile } from "./fake-upstreams.js";
import {
	type LoginPage,
	type TestAccount,
	openLoginPage,
} from "./test-accounts.js";
import { type TestBrowser, formField } from "./test-browser.js";
import { type TestIdp, localmanCallbackOf } from "./test-idp.js";

/** Login page → "Sign in with <provider>" (fake) → back on the IdP. */
export async function signInWith(
	idp: TestIdp,
	provider: "google" | "github",
	profile: FakeProfile,
	browser?: TestBrowser,
): Promise<{ page: LoginPage; response: Response; location?: URL }> {
	const page = await openLoginPage(idp, browser);
	expect(page.html).toContain(`/interaction/${page.uid}/upstream/${provider}`);
	idp.fake.nextLogins.push(profile);
	const result = await page.browser.navigate(
		`${idp.issuer}/interaction/${page.uid}/upstream/${provider}`,
		{},
		localmanCallbackOf(idp),
	);
	return { page, ...result };
}

/** What the fake Google says about the Google account linked to `account`. */
export function linkedGoogleProfile(account: TestAccount): FakeProfile {
	const id = account.providers.google;
	if (!id) throw new Error(`@${account.username} has no Google account linked`);
	return { id, email: account.email, emailVerified: true };
}

/**
 * A new account lands on the welcome screen after choosing its username:
 * checks it is there and presses "Continue", which finishes the sign-in.
 */
export async function continuePastWelcome(
	browser: TestBrowser,
	signup: { response: Response; location?: URL },
	stopAt?: string,
): Promise<{ response: Response; location?: URL }> {
	expect(signup.location).toBeUndefined();
	expect(new URL(signup.response.url).pathname).toMatch(
		/^\/interaction\/[\w-]+\/welcome$/,
	);
	const html = await signup.response.text();
	expect(html).toContain('data-id="welcome-continue"');
	return browser.navigate(
		signup.response.url,
		{ form: { csrf: formField(html, "csrf") } },
		stopAt,
	);
}
