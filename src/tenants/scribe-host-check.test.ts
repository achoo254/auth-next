import { describe, expect, it } from "vitest";
import {
	APP_HOST_KEYS,
	type OwnershipResolver,
	checkOwnershipRecords,
	hostReachesService,
} from "./ownership-records.js";

const IP = "203.0.113.65";
const DOMAIN = "acme.example.org";

const missing = (): Error =>
	Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });

/** DNS with the claim TXT and every app host here, but no `scribe.` record. */
const resolver: OwnershipResolver = {
	resolveTxt: async (name) => {
		if (name === `_auth-claim.${DOMAIN}`) return [["proof"]];
		throw missing();
	},
	resolve4: async (name) => {
		if (name.startsWith("scribe.")) throw missing();
		if (name === `down.${DOMAIN}`) {
			throw Object.assign(new Error("SERVFAIL"), { code: "ESERVFAIL" });
		}
		return [IP];
	},
};

describe("scribe.<domain> and the ownership check (ADR 0012)", () => {
	it("is not one of the hosts ownership requires", () => {
		expect(APP_HOST_KEYS).toEqual([
			"auth",
			"chat",
			"localman",
			"localmanWildcard",
			"tunnel",
			"tunnelWildcard",
		]);
	});

	it("never fails the ownership of a tenant without a scribe record", async () => {
		expect(await checkOwnershipRecords(DOMAIN, "proof", IP, resolver)).toEqual({
			result: "ok",
			wrongHosts: [],
		});
	});

	it("is checked on its own: here, missing, or unknown", async () => {
		expect(await hostReachesService(`auth.${DOMAIN}`, IP, resolver)).toBe("ok");
		expect(await hostReachesService(`scribe.${DOMAIN}`, IP, resolver)).toBe(
			"address",
		);
		expect(await hostReachesService(`down.${DOMAIN}`, IP, resolver)).toBe(
			"unknown",
		);
		expect(
			await hostReachesService(`auth.${DOMAIN}`, "198.51.100.7", resolver),
		).toBe("address");
	});
});
