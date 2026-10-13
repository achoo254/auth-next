import { describe, expect, it } from "vitest";
import { DICTIONARIES, type MessageKey } from "./dictionaries.js";
import { LOCALES } from "./locales.js";
import { translator } from "./translator.js";

const BRAND = { name: "hoandat", domain: "hoandat.com" };

/** The brand placeholders are filled by the translator, not by callers. */
const BRAND_PLACEHOLDERS = new Set(["brand", "brandDomain"]);

function placeholders(message: string): string[] {
	return [...message.matchAll(/\{(\w+)\}/g)]
		.map((match) => match[1] ?? "")
		.filter((name) => !BRAND_PLACEHOLDERS.has(name));
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

	it("names the tenant's brand wherever a message mentions it", () => {
		const acme = translator("en", { name: "Acme", domain: "acme.test" });
		expect(acme.t("account.title")).toBe("Acme account");
		expect(acme.t("consent.externalNotice")).toContain(
			"not published by acme.test",
		);
		for (const locale of LOCALES) {
			for (const key of KEYS) {
				expect(translator(locale, BRAND).t(key), key).not.toMatch(
					/\{brand(Domain)?\}/,
				);
			}
		}
	});

	it("fills placeholders and escapes rich values", () => {
		const en = translator("en", BRAND);
		expect(en.t("login.titleForApp", { app: "Localman" })).toBe(
			"Sign in to continue to Localman",
		);
		expect(en.rich("client.quoted", { name: "<b>x</b>" }).value).toBe(
			"“&lt;b&gt;x&lt;/b&gt;”",
		);
	});

	it("formats dates in Asia/Ho_Chi_Minh for each language", () => {
		const date = new Date("2026-10-09T17:30:00Z");
		expect(translator("vi", BRAND).date(date)).toBe("00:30 10/10/26");
		expect(translator("en", BRAND).date(date)).toContain("10 Oct 2026");
		expect(translator("zh-CN", BRAND).date(date)).toContain("2026/10/10");
		expect(translator("en", BRAND).date(undefined)).toBe("unknown");
	});
});
