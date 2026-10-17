import type { MessageKey } from "../../i18n/dictionaries.js";
import type { Locale } from "../../i18n/locales.js";
import { translator } from "../../i18n/translator.js";
import type { PageContext } from "../../ui/page-context.js";
import { TEST_BRAND } from "./test-tenant.js";

/** Page context for rendering a page directly in a test. */
export function testPage(locale: Locale = "en", path = "/"): PageContext {
	return { i18n: translator(locale, TEST_BRAND), path, domainGuide: false };
}

/** A message as a page in `locale` shows it (HTML-escaped). */
export function shown(key: MessageKey, locale: Locale = "en"): string {
	return translator(locale, TEST_BRAND)
		.t(key)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
