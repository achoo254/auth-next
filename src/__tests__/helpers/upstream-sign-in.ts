import { expect } from "vitest";
import type { FakeProfile } from "./fake-upstreams.js";
import {
	type LoginPage,
	type TestAccount,
	openLoginPage,
} from "./test-accounts.js";
import type { TestBrowser } from "./test-browser.js";
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
