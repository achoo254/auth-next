import { describe, expect, it } from "vitest";
import {
	localeFromAcceptLanguage,
	localeFromUiLocales,
	matchLocale,
} from "./locales.js";
import { requestLocale, resolveLocale } from "./request-locale.js";

describe("locale tags", () => {
	it("maps tags to the three page languages by primary language", () => {
		expect(matchLocale("en-GB")).toBe("en");
		expect(matchLocale("VI-vn")).toBe("vi");
		expect(matchLocale("zh")).toBe("zh-CN");
		expect(matchLocale("zh-Hant-TW")).toBe("zh-CN");
		expect(matchLocale("fr")).toBeUndefined();
		expect(matchLocale("")).toBeUndefined();
	});

	it("reads ui_locales in order of preference", () => {
		expect(localeFromUiLocales("fr zh-Hans en")).toBe("zh-CN");
		expect(localeFromUiLocales("vi")).toBe("vi");
		expect(localeFromUiLocales("de fr")).toBeUndefined();
		expect(localeFromUiLocales(["vi"])).toBeUndefined();
	});

	it("ranks Accept-Language by q-value and skips q=0 and *", () => {
		expect(localeFromAcceptLanguage("fr-FR,vi;q=0.8,en;q=0.9")).toBe("en");
		expect(localeFromAcceptLanguage("zh-TW,zh;q=0.9")).toBe("zh-CN");
		expect(localeFromAcceptLanguage("vi;q=0,en;q=0.1")).toBe("en");
		expect(localeFromAcceptLanguage("*")).toBeUndefined();
		expect(localeFromAcceptLanguage("de;q=abc,;;,")).toBeUndefined();
		expect(localeFromAcceptLanguage(undefined)).toBeUndefined();
	});
});

describe("page language", () => {
	it("picks this sign-in's pick, then ui_locales, cookie, Accept-Language, English", () => {
		const all = {
			pickedForInteraction: "vi",
			uiLocales: "zh-CN",
			cookie: "en",
			acceptLanguage: "zh",
		};
		expect(resolveLocale(all)).toBe("vi");
		expect(resolveLocale({ ...all, pickedForInteraction: undefined })).toBe(
			"zh-CN",
		);
		expect(
			resolveLocale({ ...all, pickedForInteraction: "xx", uiLocales: "fr" }),
		).toBe("en");
		expect(
			resolveLocale({
				uiLocales: undefined,
				cookie: "zh-cn",
				acceptLanguage: "vi",
			}),
		).toBe("vi");
		expect(resolveLocale({})).toBe("en");
	});

	it("reads the cookies and header of a request", () => {
		expect(
			requestLocale({
				headers: { cookie: "a=1; hd_lang=zh-CN", "accept-language": "vi" },
			}),
		).toBe("zh-CN");
		expect(
			requestLocale(
				{ headers: { cookie: "hd_lang=zh-CN", "accept-language": "vi" } },
				"vi-VN",
			),
		).toBe("vi");
		expect(
			requestLocale(
				{ headers: { cookie: "hd_lang_interaction=en; hd_lang=vi" } },
				"zh",
			),
		).toBe("en");
	});
});
