import type { AccountDocument } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";

/**
 * Tells the account owner about a security-relevant change on their linked
 * Telegram chat (password changed, recovery codes regenerated, new sign-in
 * method linked, email reclaimed). Best effort and in the background: a
 * Telegram outage never blocks or fails the change itself.
 */
export function notifyTelegram(
	services: AppServices,
	account: Pick<AccountDocument, "_id" | "telegram"> | undefined,
	text: string,
): void {
	const bot = services.telegram;
	const chatId = account?.telegram?.chatId;
	if (!bot || !chatId) return;
	bot.sendMessage(chatId, text).catch((error: unknown) => {
		services.logger.warn(
			{ err: error, accountId: account?._id },
			"Telegram notice not sent",
		);
	});
}
