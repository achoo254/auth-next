import { type HtmlValue, type SafeHtml, html } from "../ui/html.js";
import { DICTIONARIES, type MessageKey } from "./dictionaries.js";
import type { Locale } from "./locales.js";

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * Who the pages speak for: the tenant's display name and domain. Messages
 * name them through `{brand}` and `{brandDomain}`, filled in automatically.
 */
export interface Brand {
	readonly name: string;
	readonly domain: string;
}

/** BCP 47 tag handed to Intl for each page language. */
const INTL_LOCALE: Readonly<Record<Locale, string>> = {
	en: "en-GB",
	"zh-CN": "zh-CN",
	vi: "vi-VN",
};

/** Dates on every page are shown in Vietnam's time zone, in any language. */
export const PAGE_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** Messages of one language, plus its date format. */
export interface Translator {
	readonly locale: Locale;
	readonly brand: Brand;
	/** Plain text; `{name}` placeholders are filled from `params`. */
	t(key: MessageKey, params?: MessageParams): string;
	/**
	 * Markup: the message text is escaped, `SafeHtml` values (a bold app
	 * name, a link) are kept, any other value is escaped.
	 */
	rich(key: MessageKey, params: Readonly<Record<string, HtmlValue>>): SafeHtml;
	/** Short date and time in Asia/Ho_Chi_Minh, "unknown" when missing. */
	date(value: Date | undefined): string;
}

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(message: string, params: MessageParams): string {
	return message.replace(PLACEHOLDER, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

const cache = new Map<string, Translator>();
/** Brands are tenants' names and change: the cache stays bounded. */
const MAX_CACHED_TRANSLATORS = 300;

function createTranslator(locale: Locale, brand: Brand): Translator {
	const brandParams: MessageParams = {
		brand: brand.name,
		brandDomain: brand.domain,
	};
	const messages = DICTIONARIES[locale];
	const dates = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
		timeZone: PAGE_TIME_ZONE,
		// "10 Oct 2026, 08:15": a numeric English date reads two ways.
		dateStyle: locale === "en" ? "medium" : "short",
		timeStyle: "short",
	});
	const t = (key: MessageKey, params?: MessageParams): string =>
		fill(messages[key], { ...brandParams, ...params });
	return {
		locale,
		brand,
		t,
		rich(key, params) {
			// split() with a capture group: odd entries are placeholder names.
			const parts = messages[key].split(/\{(\w+)\}/);
			return html`${parts.map((part, index) =>
				index % 2 === 0
					? part
					: (params[part] ?? brandParams[part] ?? `{${part}}`),
			)}`;
		},
		date(value) {
			return value ? dates.format(value) : t("common.unknown");
		},
	};
}

/** The (shared, stateless) translator of a language for one brand. */
export function translator(locale: Locale, brand: Brand): Translator {
	const key = `${locale}\n${brand.name}\n${brand.domain}`;
	let found = cache.get(key);
	if (!found) {
		if (cache.size >= MAX_CACHED_TRANSLATORS) cache.clear();
		found = createTranslator(locale, brand);
		cache.set(key, found);
	}
	return found;
}

/** The brand of a tenant. */
export function brandOf(tenant: {
	readonly displayName: string;
	readonly domain: string;
}): Brand {
	return { name: tenant.displayName, domain: tenant.domain };
}
