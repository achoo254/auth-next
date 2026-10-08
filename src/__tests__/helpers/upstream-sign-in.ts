import { expect } from "vitest";
import type { FakeProfile, FakeUpstreams } from "./fake-upstreams.js";
import { type LoginPage, openLoginPage } from "./test-accounts.js";
import { LOCALMAN_CALLBACK, type TestIdp } from "./test-idp.js";

/** Login page → "Đăng nhập với <provider>" (fake) → back on the IdP. */
export async function signInWith(
	idp: TestIdp,
	fake: FakeUpstreams,
	provider: "google" | "github",
	profile: FakeProfile,
	query = "",
): Promise<{ page: LoginPage; response: Response; location?: URL }> {
	const page = await openLoginPage(idp);
	expect(page.html).toContain(`/interaction/${page.uid}/upstream/${provider}`);
	fake.nextLogins.push(profile);
	const result = await page.browser.navigate(
		`${idp.issuer}/interaction/${page.uid}/upstream/${provider}${query}`,
		{},
		LOCALMAN_CALLBACK,
	);
	return { page, ...result };
}
