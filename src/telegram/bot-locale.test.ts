import { describe, expect, it } from "vitest";
import { localeFromTelegram, noticeLocale } from "./bot-locale.js";

describe("Telegram language_code", () => {
	it.each([
		["zh-hans", "zh-CN"],
		["zh-CN", "zh-CN"],
		["zh", "zh-CN"],
		["zh-hant", "zh-CN"],
		["zh-tw", "zh-CN"],
		["vi", "vi"],
		["vi-VN", "vi"],
		["en", "en"],
		["fr", "en"],
		["", "en"],
		[undefined, "en"],
	])("%j is %s", (code, locale) => {
		expect(localeFromTelegram(code)).toBe(locale);
	});
});

describe("language of notices the bot sends on its own", () => {
	it("is the stored language, English without one", () => {
		expect(noticeLocale({ telegramLocale: "zh-CN" })).toBe("zh-CN");
		expect(noticeLocale({})).toBe("en");
	});
});
