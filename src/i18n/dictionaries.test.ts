import { describe, expect, it } from "vitest";
import { DICTIONARIES, type MessageKey } from "./dictionaries.js";
import { LOCALES } from "./locales.js";
import { translator } from "./translator.js";

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "");
}

const KEYS = Object.keys(DICTIONARIES.en) as MessageKey[];

describe("dictionaries", () => {
	it.each(LOCALES)(
		"%s has every key, filled in, with the English placeholders",
		(locale) => {
			const messages = DICTIONARIES[locale];
			expect(Object.keys(messages).sort()).toEqual([...KEYS].sort());
			for (const key of KEYS) {
				expect(messages[key].trim(), key).not.toBe("");
				expect(placeholders(messages[key]).sort(), key).toEqual(
					placeholders(DICTIONARIES.en[key]).sort(),
				);
			}
		},
	);

	it("fills placeholders and escapes rich values", () => {
		const en = translator("en");
		expect(en.t("login.titleForApp", { app: "Localman" })).toBe(
			"Sign in to continue to Localman",
		);
		expect(en.rich("client.quoted", { name: "<b>x</b>" }).value).toBe(
			"“&lt;b&gt;x&lt;/b&gt;”",
		);
	});

	it("formats dates in Asia/Ho_Chi_Minh for each language", () => {
		const date = new Date("2026-10-09T17:30:00Z");
		expect(translator("vi").date(date)).toBe("00:30 10/10/26");
		expect(translator("en").date(date)).toContain("10 Oct 2026");
		expect(translator("zh-CN").date(date)).toContain("2026/10/10");
		expect(translator("en").date(undefined)).toBe("unknown");
	});
});
