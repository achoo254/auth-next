import { describe, expect, it } from "vitest";
import { verifyFailureQuery, wrongRecordsFrom } from "./claim-dns-feedback.js";

describe("DNS feedback on /claim", () => {
	it("carries the wrong hosts of a claim through the redirect", () => {
		const query = verifyFailureQuery("dns-address", "clm_1", [
			"chat",
			"localmanWildcard",
		]);
		expect(query).toBe(
			"error=dns-address&claim=clm_1&hosts=chat%2ClocalmanWildcard",
		);
		expect(
			wrongRecordsFrom(Object.fromEntries(new URLSearchParams(query))),
		).toEqual({
			claimId: "clm_1",
			hosts: ["chat", "localmanWildcard"],
		});
	});

	it("names no hosts for other errors", () => {
		expect(verifyFailureQuery("dns-txt", "clm_1", ["chat"])).toBe(
			"error=dns-txt",
		);
	});

	it("ignores anything that is not a known host key", () => {
		expect(
			wrongRecordsFrom({ claim: "clm_1", hosts: "<b>x</b>,auth" }),
		).toEqual({ claimId: "clm_1", hosts: ["auth"] });
		expect(wrongRecordsFrom({ claim: "clm_1", hosts: "nope" })).toBeUndefined();
		expect(wrongRecordsFrom({ claim: ["a"], hosts: "auth" })).toBeUndefined();
		expect(wrongRecordsFrom(undefined)).toBeUndefined();
	});
});
