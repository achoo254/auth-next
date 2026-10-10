import { AccountConflictError } from "../accounts/account-conflicts.js";
import type { AccountDocument } from "../accounts/user-model.js";
import type { Locale } from "../i18n/locales.js";
import { translator } from "../i18n/translator.js";
import type { AppServices } from "../services.js";
import type { TelegramBot } from "./bot-client.js";
import { noticeLocale } from "./bot-locale.js";
import {
	type LinkCodeHolder,
	consumeTelegramLinkCode,
	peekTelegramLinkCode,
} from "./link-routes.js";
import type { TelegramChat } from "./webhook-routes.js";

/**
 * The account behind a link code, while the code is unused and the IdP
 * session that created it still exists (signing out, or revoking that
 * session at /account, voids the code).
 */
async function ownerAccount(
	services: AppServices,
	holder: LinkCodeHolder | undefined,
): Promise<AccountDocument | undefined> {
	if (!holder) return undefined;
	const session = await services.provider.Session.findByUid(holder.sessionUid);
	return session?.accountId === holder.account._id ? holder.account : undefined;
}

/** Who a still-valid link code is for, and the language it was made in. */
export interface LinkCodeTarget {
	readonly username: string;
	readonly locale?: Locale;
}

/** The account a still-valid link code belongs to. */
export async function describeLinkCode(
	services: AppServices,
	code: string,
): Promise<LinkCodeTarget | undefined> {
	const holder = await peekTelegramLinkCode(services.accountTokens, code);
	const account = await ownerAccount(services, holder);
	return account
		? { username: account.username, locale: holder?.locale }
		: undefined;
}

function chatName(chat: TelegramChat): string | undefined {
	const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
	return name || undefined;
}

/**
 * The confirm button was pressed: uses the code, links the chat (keeping
 * its @username and name for the account page, and the code's language
 * for later notices) and tells a previously linked chat that it no longer
 * receives anything. Replies in the code's language, else `chatLocale`
 * (the chat's Telegram language). Returns the short text shown on the
 * button press.
 */
export async function confirmTelegramLink(
	services: AppServices,
	bot: TelegramBot,
	chat: TelegramChat,
	code: string,
	chatLocale: Locale,
): Promise<string> {
	const chatId = String(chat.id);
	const holder = await consumeTelegramLinkCode(services.accountTokens, code);
	const { t } = translator(holder?.locale ?? chatLocale);
	const expired = async (): Promise<string> => {
		await bot.sendMessage(chatId, t("bot.link.expired"));
		return t("bot.link.expiredShort");
	};
	const account = await ownerAccount(services, holder);
	if (!account) return expired();
	try {
		const write = await services.accounts.links.setTelegram(
			account._id,
			{
				chatId,
				username: chat.username,
				name: chatName(chat),
				locale: holder?.locale,
			},
			holder?.version,
		);
		if (!write.applied) return expired();
	} catch (error) {
		if (!(error instanceof AccountConflictError)) throw error;
		await bot.sendMessage(chatId, t("bot.link.otherAccount"));
		return t("bot.link.otherAccountShort");
	}
	const previous = account.telegram?.chatId;
	if (previous && previous !== chatId) {
		// The old chat hears it in its own language: whoever moved the link
		// may not be the owner reading that chat.
		const moved = translator(noticeLocale(account)).t("bot.link.moved", {
			username: account.username,
		});
		await bot.sendMessage(previous, moved).catch((error: unknown) => {
			services.logger.warn({ err: error }, "Old Telegram chat not notified");
		});
	}
	services.logger.info({ accountId: account._id }, "Telegram linked");
	await bot.sendMessage(
		chatId,
		t("bot.link.done", { username: account.username }),
	);
	return t("bot.link.doneShort");
}
