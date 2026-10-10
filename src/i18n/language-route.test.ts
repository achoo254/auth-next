import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./language-route.js";

const ISSUER = "https://auth.example.test";

describe("language switcher return path", () => {
	it("keeps same-origin paths with their query", () => {
		expect(safeReturnPath("/account", ISSUER)).toBe("/account");
		expect(safeReturnPath("/interaction/abc-1?x=1#h", ISSUER)).toBe(
			"/interaction/abc-1?x=1",
		);
		expect(safeReturnPath("/device?user_code=ABCD-EFGH", ISSUER)).toBe(
			"/device?user_code=ABCD-EFGH",
		);
	});

	it.each([
		undefined,
		"",
		"account",
		"//evil.example",
		"///evil.example",
		"/\\evil.example",
		"/\\/evil.example",
		"\\\\evil.example",
		"https://evil.example/",
		"javascript:alert(1)",
		"/\t/evil.example",
		"/x\r\nSet-Cookie: a=b",
		"/lang?set=vi&return=/account",
		"/LANG/",
		`/${"a".repeat(2100)}`,
	])("refuses %j", (raw) => {
		expect(safeReturnPath(raw, ISSUER)).toBeUndefined();
	});
});
