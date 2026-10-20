import { describe, expect, it } from "vitest";
import { parseInternalCredentials } from "./internal-auth.js";

const SECRET = "s".repeat(32);

describe("parseInternalCredentials", () => {
	it("accepts one secret per role, scribe included", () => {
		const credentials = parseInternalCredentials(
			`localman:${SECRET}, tunelo:${SECRET}a,provisioner:${SECRET}b,scribe:${SECRET}c`,
		);
		expect([...credentials.keys()]).toEqual([
			"localman",
			"tunelo",
			"provisioner",
			"scribe",
		]);
		expect(credentials.get("scribe")).toBe(`${SECRET}c`);
	});

	it("is empty when unset, which turns the internal API off", () => {
		expect(parseInternalCredentials(undefined).size).toBe(0);
		expect(parseInternalCredentials("").size).toBe(0);
	});

	it("refuses unknown roles, short secrets and malformed entries", () => {
		for (const value of [
			`chat:${SECRET}`,
			`scribe:${"s".repeat(31)}`,
			SECRET,
			`:${SECRET}`,
		]) {
			expect(() => parseInternalCredentials(value), value).toThrow(
				"roles localman, tunelo, provisioner, scribe;",
			);
		}
	});
});
