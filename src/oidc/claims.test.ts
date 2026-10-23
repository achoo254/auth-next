import { describe, expect, it } from "vitest";
import { type AccountProfile, profileToClaims } from "./claims.js";
import { STATIC_CLIENT_IDS } from "./clients.js";

const profile: AccountProfile = {
	sub: "acct-1",
	username: "parent",
	email: "parent@example.vn",
	emailVerified: true,
	telegramLinked: false,
	googleSub: "google-123",
};

describe("google_sub", () => {
	it("goes to the Miu World clients only, and only at userinfo", () => {
		for (const id of [
			STATIC_CLIENT_IDS.miuWeb,
			STATIC_CLIENT_IDS.miuMobile,
			STATIC_CLIENT_IDS.miuWebDev,
		]) {
			expect(profileToClaims(profile, "userinfo", id).google_sub).toBe(
				"google-123",
			);
			expect(profileToClaims(profile, "id_token", id).google_sub).toBe(
				undefined,
			);
		}
		for (const id of [
			STATIC_CLIENT_IDS.scribeWeb,
			STATIC_CLIENT_IDS.chatWeb,
			STATIC_CLIENT_IDS.localmanWeb,
			"dcr-client",
			undefined,
		]) {
			expect(profileToClaims(profile, "userinfo", id).google_sub).toBe(
				undefined,
			);
		}
	});
});
