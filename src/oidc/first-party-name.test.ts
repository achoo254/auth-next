import { describe, expect, it } from "vitest";
import { imitatesFirstPartyName } from "./first-party-name.js";

describe("imitatesFirstPartyName", () => {
	it.each([
		"Localman",
		"Claude Code (localman)",
		"TUNELO CLI",
		"hoandat account",
		"My LocalMan helper",
		"Loca\u217cman", // small roman numeral fifty
		"LocaIman", // capital i
		"L o c a l m a n",
		"Tun\u0435lo", // Cyrillic е
		"h\u043eandat", // Cyrillic о
		"\u04bb\u03bfandat", // Cyrillic һ, Greek ο
	])("flags %s", (name) => {
		expect(imitatesFirstPartyName(name)).toBe(true);
	});

	it.each(["Claude Code", "Cursor", "Agent", "Postman", "Tunnel"])(
		"leaves %s alone",
		(name) => {
			expect(imitatesFirstPartyName(name)).toBe(false);
		},
	);
});
