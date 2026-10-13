import type { AccountDocument } from "../accounts/user-model.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { type MessageParams, brandOf, translator } from "../i18n/translator.js";
import type { AppServices } from "../services.js";
import { noticeLocale } from "./bot-locale.js";

/**
 * Tells the account owner about a security-relevant change on their linked
 * Telegram chat (new sign-in method linked, email reclaimed), in the
 * language stored with the link (English without one). Best effort and in
 * the background: a Telegram outage never blocks or fails the change itself.
 */
export function notifyTelegram(
	services: AppServices,
	account:
		| Pick<AccountDocument, "_id" | "telegram" | "telegramLocale">
		| undefined,
	key: MessageKey,
	params: MessageParams,
): void {
	const bot = services.telegram;
	const chatId = account?.telegram?.chatId;
	if (!bot || !account || !chatId) return;
	const text = translator(noticeLocale(account), brandOf(services.tenant)).t(
		key,
		params,
	);
	bot.sendMessage(chatId, text).catch((error: unknown) => {
		services.logger.warn(
			{ err: error, accountId: account._id },
			"Telegram notice not sent",
		);
	});
}
