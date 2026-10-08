import { z } from "zod";
import type { TelegramBotConfig } from "../config/integrations-env.js";

const apiResponse = z.object({
	ok: z.boolean(),
	description: z.string().optional(),
});

/** One inline button: opens a URL, or sends `callbackData` back to the bot. */
export type TelegramButton =
	| { readonly text: string; readonly url: string }
	| { readonly text: string; readonly callbackData: string };

export interface TelegramBot {
	/** Bot username (no @), for t.me deep links. */
	readonly username: string;
	readonly webhookSecret: string;
	sendMessage(
		chatId: string,
		text: string,
		button?: TelegramButton,
	): Promise<void>;
	/** Stops the spinner on a pressed inline button. */
	answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
}

export class TelegramApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelegramApiError";
	}
}

/**
 * Minimal Bot API client over fetch. The base URL is configurable so tests
 * can point it at a fake. The bot token is part of every request URL, so
 * errors describe the method and status only, never the URL.
 */
export function createTelegramBot(config: TelegramBotConfig): TelegramBot {
	const call = async (method: string, body: object): Promise<void> => {
		let response: Response;
		try {
			response = await fetch(
				`${config.apiBaseUrl}/bot${config.token}/${method}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: AbortSignal.timeout(10_000),
				},
			);
		} catch (error) {
			const reason = error instanceof Error ? error.name : "unknown";
			throw new TelegramApiError(`Telegram ${method} failed: ${reason}`);
		}
		const parsed = apiResponse.safeParse(
			await response.json().catch(() => undefined),
		);
		if (!response.ok || !parsed.success || !parsed.data.ok) {
			throw new TelegramApiError(
				`Telegram ${method} answered HTTP ${response.status}`,
			);
		}
	};

	return {
		username: config.username,
		webhookSecret: config.webhookSecret,
		sendMessage(chatId, text, button) {
			return call("sendMessage", {
				chat_id: chatId,
				text,
				link_preview_options: { is_disabled: true },
				...(button
					? {
							reply_markup: {
								inline_keyboard: [
									[
										"url" in button
											? { text: button.text, url: button.url }
											: {
													text: button.text,
													callback_data: button.callbackData,
												},
									],
								],
							},
						}
					: {}),
			});
		},
		answerCallbackQuery(callbackQueryId, text) {
			return call("answerCallbackQuery", {
				callback_query_id: callbackQueryId,
				text,
			});
		},
	};
}
