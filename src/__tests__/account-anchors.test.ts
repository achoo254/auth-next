import { describe, expect, it } from "vitest";
import { renderAccountPage } from "../account-portal/account-page.js";

/** Localman links straight to these sections of /account. */
const ANCHORS = [
	"account-email",
	"account-password",
	"account-recovery",
	"account-apps",
];

describe("/account anchors", () => {
	it("gives each linked section a matching id and keeps its data-id", () => {
		const page = renderAccountPage({
			host: "auth.example.test",
			csrf: "csrf-token",
			account: {
				_id: "acc_anchor",
				username: "minh_anh",
				email: "minh.anh@example.com",
				emailVerifiedBy: null,
				recoveryCodeHashes: [],
				providers: {},
				createdAt: new Date(0),
			},
			currentSessionUid: "session-1",
			providers: [],
			telegramEnabled: false,
			sessions: [],
			devices: [],
			apps: [],
		});
		for (const anchor of ANCHORS) {
			// A real id attribute (not the tail of data-id), exactly once.
			const ids = page.match(new RegExp(`\\sid="${anchor}"`, "g"));
			expect(ids, anchor).toHaveLength(1);
			expect(page, anchor).toContain(`data-id="${anchor}"`);
		}
	});
});
