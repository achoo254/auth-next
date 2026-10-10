import type { AccountDocument } from "../accounts/user-model.js";
import { DEFAULT_LOCALE, type Locale, isLocale } from "../i18n/locales.js";

/**
 * The bot's language for a chat with no stored language, from the
 * `language_code` Telegram sends with each update (the user's app
 * language): any Chinese tag is zh-CN and any Vietnamese tag is vi, as the
 * IdP's pages read Accept-Language; everything else is English.
 */
export function localeFromTelegram(languageCode: string | undefined): Locale {
	const tag = (languageCode ?? "").trim().toLowerCase().replace(/_/g, "-");
	const language = tag.split("-")[0];
	if (language === "zh") return "zh-CN";
	if (language === "vi") return "vi";
	return DEFAULT_LOCALE;
}

/**
 * Language for a message the bot sends on its own (not as a reply): the
 * language stored with the account's link, English when there is none.
 */
export function noticeLocale(
	account: Pick<AccountDocument, "telegramLocale">,
): Locale {
	return isLocale(account.telegramLocale)
		? account.telegramLocale
		: DEFAULT_LOCALE;
}
