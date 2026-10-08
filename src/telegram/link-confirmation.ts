import { AccountConflictError } from "../accounts/account-conflicts.js";
import type { AccountDocument } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";
import type { TelegramBot } from "./bot-client.js";
import {
	type LinkCodeHolder,
	consumeTelegramLinkCode,
	peekTelegramLinkCode,
} from "./link-routes.js";
import type { TelegramChat } from "./webhook-routes.js";

/**
 * The account behind a link code, while the code is unused and the IdP
 * session that created it still exists (signing out, or a password reset,
 * ends that session and so voids the code).
 */
async function ownerAccount(
	services: AppServices,
	holder: LinkCodeHolder | undefined,
): Promise<AccountDocument | undefined> {
	if (!holder) return undefined;
	const session = await services.provider.Session.findByUid(holder.sessionUid);
	return session?.accountId === holder.account._id ? holder.account : undefined;
}

/** Username of the account a still-valid link code belongs to. */
export async function describeLinkCode(
	services: AppServices,
	code: string,
): Promise<string | undefined> {
	const holder = await peekTelegramLinkCode(services.accountTokens, code);
	return (await ownerAccount(services, holder))?.username;
}

function chatName(chat: TelegramChat): string | undefined {
	const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
	return name || undefined;
}

/**
 * The confirm button was pressed: uses the code, links the chat (keeping
 * its @username and name for the account page) and tells a previously
 * linked chat that it no longer receives anything. Returns the short text
 * shown on the button press.
 */
export async function confirmTelegramLink(
	services: AppServices,
	bot: TelegramBot,
	chat: TelegramChat,
	code: string,
): Promise<string> {
	const chatId = String(chat.id);
	const holder = await consumeTelegramLinkCode(services.accountTokens, code);
	const account = await ownerAccount(services, holder);
	if (!account) {
		await bot.sendMessage(
			chatId,
			"Link liên kết đã hết hạn hoặc đã được dùng. Tạo link mới ở trang tài khoản hoandat.",
		);
		return "Link đã hết hạn";
	}
	try {
		const write = await services.accounts.links.setTelegram(
			account._id,
			{ chatId, username: chat.username, name: chatName(chat) },
			holder?.version,
		);
		if (!write.applied) {
			await bot.sendMessage(
				chatId,
				"Link liên kết đã hết hạn hoặc đã được dùng. Tạo link mới ở trang tài khoản hoandat.",
			);
			return "Link đã hết hạn";
		}
	} catch (error) {
		if (!(error instanceof AccountConflictError)) throw error;
		await bot.sendMessage(
			chatId,
			"Chat Telegram này đã liên kết với một tài khoản hoandat khác. Huỷ liên kết ở tài khoản đó trước.",
		);
		return "Chat đã liên kết tài khoản khác";
	}
	const previous = account.telegram?.chatId;
	if (previous && previous !== chatId) {
		await bot
			.sendMessage(
				previous,
				`Tài khoản hoandat @${account.username} đã chuyển liên kết sang một chat Telegram khác. Chat này sẽ không nhận thông báo hay link đặt lại mật khẩu nữa.`,
			)
			.catch((error: unknown) => {
				services.logger.warn({ err: error }, "Old Telegram chat not notified");
			});
	}
	services.logger.info({ accountId: account._id }, "Telegram linked");
	await bot.sendMessage(
		chatId,
		`Đã liên kết Telegram với tài khoản hoandat @${account.username}. Bạn sẽ nhận thông báo và link đặt lại mật khẩu ở đây.`,
	);
	return "Đã liên kết";
}
