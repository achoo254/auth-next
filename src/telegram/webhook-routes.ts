import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, Router } from "express";
import { z } from "zod";
import type { Locale } from "../i18n/locales.js";
import { translator } from "../i18n/translator.js";
import type { AppServices } from "../services.js";
import type { TelegramBot } from "./bot-client.js";
import { localeFromTelegram } from "./bot-locale.js";
import { confirmTelegramLink, describeLinkCode } from "./link-confirmation.js";

export const WEBHOOK_PATH = "/telegram/webhook";
export const SECRET_HEADER = "x-telegram-bot-api-secret-token";
/** Inline-button payload that confirms a link: `link:<code>` (≤ 64 bytes). */
export const LINK_CALLBACK_PREFIX = "link:";

const chat = z.object({
	id: z.union([z.number(), z.string()]),
	type: z.string(),
	username: z.string().max(64).optional(),
	first_name: z.string().max(128).optional(),
	last_name: z.string().max(128).optional(),
});

/** The sender; `language_code` is their Telegram app's language (IETF tag). */
const from = z.object({ language_code: z.string().max(35).optional() });

const update = z.object({
	message: z
		.object({
			text: z.string().max(4096).optional(),
			chat,
			from: from.optional(),
		})
		.optional(),
	callback_query: z
		.object({
			id: z.string(),
			data: z.string().max(64).optional(),
			from: from.optional(),
			message: z.object({ chat }).optional(),
		})
		.optional(),
});

export type TelegramChat = z.infer<typeof chat>;

/** Constant-time comparison of the secret header (hashed to equal length). */
export function hasValidSecret(req: Request, expected: string): boolean {
	const received = req.get(SECRET_HEADER);
	if (!received) return false;
	const digest = (value: string): Buffer =>
		createHash("sha256").update(value).digest();
	return timingSafeEqual(digest(received), digest(expected));
}

/**
 * `/start <code>`: ask the chat to confirm, without using the code yet, in
 * the language of the page that made the code. Without a valid code,
 * explain how to get one in the chat's Telegram language.
 */
async function askToConfirm(
	services: AppServices,
	bot: TelegramBot,
	chatId: string,
	code: string | undefined,
	chatLocale: Locale,
): Promise<void> {
	const target = code ? await describeLinkCode(services, code) : undefined;
	if (!code || !target) {
		const { t } = translator(chatLocale);
		await bot.sendMessage(
			chatId,
			t("bot.start.howTo", { button: t("account.telegram.link") }),
		);
		return;
	}
	const { t } = translator(target.locale ?? chatLocale);
	await bot.sendMessage(
		chatId,
		t("bot.link.ask", { username: target.username }),
		{
			text: t("bot.link.confirm"),
			callbackData: `${LINK_CALLBACK_PREFIX}${code}`,
		},
	);
}

/**
 * POST /telegram/webhook. Telegram proves itself with the secret token set
 * at setWebhook; anything else gets 401. `/start <code>` only asks for a
 * confirmation; pressing the button links the chat. Valid calls always get
 * 200 so Telegram does not retry, even when the update is not for us.
 */
export function createTelegramWebhookRouter(services: AppServices): Router {
	const router = Router();
	const bot = services.telegram;
	router.post(WEBHOOK_PATH, express.json({ limit: "64kb" }), (req, res) => {
		if (!bot) {
			res.sendStatus(404);
			return;
		}
		if (!hasValidSecret(req, bot.webhookSecret)) {
			res.sendStatus(401);
			return;
		}
		const parsed = update.safeParse(req.body);
		const message = parsed.success ? parsed.data.message : undefined;
		const callback = parsed.success ? parsed.data.callback_query : undefined;
		let work: Promise<void> | undefined;
		if (message?.chat.type === "private") {
			const [command, code] = (message.text ?? "").trim().split(/\s+/);
			if (command === "/start") {
				work = askToConfirm(
					services,
					bot,
					String(message.chat.id),
					code,
					localeFromTelegram(message.from?.language_code),
				);
			}
		} else if (
			callback?.message?.chat.type === "private" &&
			callback.data?.startsWith(LINK_CALLBACK_PREFIX)
		) {
			const code = callback.data.slice(LINK_CALLBACK_PREFIX.length);
			work = confirmTelegramLink(
				services,
				bot,
				callback.message.chat,
				code,
				localeFromTelegram(callback.from?.language_code),
			).then((text) => bot.answerCallbackQuery(callback.id, text));
		}
		(work ?? Promise.resolve())
			.catch((error: unknown) => {
				// Logged, not retried: a failed reply must not replay the update.
				services.logger.warn(
					{ err: error },
					"Telegram webhook handling failed",
				);
			})
			.finally(() => {
				res.json({});
			});
	});
	return router;
}
