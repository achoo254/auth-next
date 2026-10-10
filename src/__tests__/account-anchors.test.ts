import { describe, expect, it } from "vitest";
import {
	type AccountView,
	renderAccountPage,
} from "../account-portal/account-page.js";
import type { AccountDocument } from "../accounts/user-model.js";
import { testPage } from "./helpers/test-page.js";

/** Localman links straight to these sections of /account. */
const ANCHORS = ["account-email", "account-sign-in", "account-apps"];

function page(
	account: Partial<AccountDocument>,
	providers: AccountView["providers"],
): string {
	return renderAccountPage({
		host: "auth.example.test",
		page: testPage(),
		csrf: "csrf-token",
		account: {
			_id: "acc_anchor",
			username: "minh_anh",
			email: "minh.anh@example.com",
			emailVerifiedBy: null,
			providers: {},
			createdAt: new Date(0),
			...account,
		},
		currentSessionUid: "session-1",
		providers,
		telegramEnabled: false,
		sessions: [],
		devices: [],
		apps: [],
	});
}

describe("/account anchors", () => {
	it("gives each linked section a matching id and keeps its data-id", () => {
		const html = page({}, []);
		for (const anchor of ANCHORS) {
			// A real id attribute (not the tail of data-id), exactly once.
			const ids = html.match(new RegExp(`\\sid="${anchor}"`, "g"));
			expect(ids, anchor).toHaveLength(1);
			expect(html, anchor).toContain(`data-id="${anchor}"`);
		}
		expect(html).not.toContain('id="account-password"');
		expect(html).not.toContain('id="account-recovery"');
		expect(html).not.toContain('type="password"');
	});
});

describe("/account sign-in methods", () => {
	it("never offers to unlink the last provider that can sign in", () => {
		const onlyGoogle = page({ providers: { google: "g-1" } }, [
			"google",
			"github",
		]);
		expect(onlyGoogle).not.toContain('data-id="provider-unlink-google"');
		expect(onlyGoogle).toContain("your only way to sign in");
		expect(onlyGoogle).toContain('data-id="provider-link-github"');

		const both = page({ providers: { google: "g-1", github: "1" } }, [
			"google",
			"github",
		]);
		expect(both).toContain('data-id="provider-unlink-google"');
		expect(both).toContain('data-id="provider-unlink-github"');
	});

	it("does not count a provider whose sign-in is switched off", () => {
		const html = page({ providers: { google: "g-1", github: "1" } }, [
			"google",
		]);
		expect(html).not.toContain('data-id="provider-unlink-google"');
		expect(html).toContain('data-id="provider-unlink-github"');
		expect(html).toContain("turned off for now");
	});
});
