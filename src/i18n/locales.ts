/**
 * Languages of the IdP pages, the same three as Localman: English is the
 * source and the default, then Simplified Chinese and Vietnamese.
 */
export const LOCALES = ["en", "zh-CN", "vi"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Each language in its own words (endonyms), never translated. */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
	en: "English",
	"zh-CN": "中文",
	vi: "Tiếng Việt",
};

export function isLocale(value: unknown): value is Locale {
	return (
		typeof value === "string" && (LOCALES as readonly string[]).includes(value)
	);
}

/**
 * The supported locale for a BCP 47 tag, by its primary language: "vi-VN"
 * is vi, "en-GB" is en, and every Chinese tag ("zh", "zh-Hans", "zh-TW")
 * is zh-CN, the only Chinese the pages are written in.
 */
export function matchLocale(tag: string): Locale | undefined {
	const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
	if (primary === "en") return "en";
	if (primary === "vi") return "vi";
	if (primary === "zh") return "zh-CN";
	return undefined;
}

/** `ui_locales`: space-separated tags in order of preference. */
export function localeFromUiLocales(value: unknown): Locale | undefined {
	if (typeof value !== "string") return undefined;
	for (const tag of value.split(" ").slice(0, 20)) {
		const locale = tag ? matchLocale(tag) : undefined;
		if (locale) return locale;
	}
	return undefined;
}

/** The best supported language of an Accept-Language header, by q-value. */
export function localeFromAcceptLanguage(
	header: string | undefined,
): Locale | undefined {
	if (!header) return undefined;
	const ranked = header
		.slice(0, 1000)
		.split(",")
		.slice(0, 30)
		.map((part, index) => {
			const [tag = "", ...params] = part.split(";");
			const q = params
				.map((param) => /^\s*q=([0-9.]+)\s*$/i.exec(param)?.[1])
				.find((value) => value !== undefined);
			return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
		})
		.filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
		.sort((a, b) => b.q - a.q || a.index - b.index);
	for (const entry of ranked) {
		const locale = matchLocale(entry.tag);
		if (locale) return locale;
	}
	return undefined;
}
