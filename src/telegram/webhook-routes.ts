import { createHash, timingSafeEqual } from "node:crypto";
import express, { type Request, Router } from "express";
import { z } from "zod";
import type { AppServices } from "../services.js";
import type { TelegramBot } from "./bot-client.js";
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

const update = z.object({
	message: z.object({ text: z.string().max(4096).optional(), chat }).optional(),
	callback_query: z
		.object({
			id: z.string(),
			data: z.string().max(64).optional(),
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

/** `/start <code>`: ask the chat to confirm, without using the code yet. */
async function askToConfirm(
	services: AppServices,
	bot: TelegramBot,
	chatId: string,
	code: string | undefined,
): Promise<void> {
	const username = code ? await describeLinkCode(services, code) : undefined;
	if (!code || !username) {
		await bot.sendMessage(
			chatId,
			"Để liên kết, mở trang tài khoản hoandat và bấm “Liên kết Telegram”. Link cũ hết hạn sau 10 phút và chỉ dùng được một lần.",
		);
		return;
	}
	await bot.sendMessage(
		chatId,
		`Liên kết chat Telegram này với tài khoản hoandat @${username}? Chỉ bấm xác nhận nếu chính bạn vừa mở link từ trang tài khoản.`,
		{
			text: "Xác nhận liên kết",
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
				work = askToConfirm(services, bot, String(message.chat.id), code);
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
