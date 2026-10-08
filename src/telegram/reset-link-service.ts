import type {
	AccountTokens,
	TokenChannel,
} from "../accounts/account-tokens.js";
import { randomToken } from "../accounts/one-time-tokens.js";
import type { AccountDocument } from "../accounts/user-model.js";
import type { TelegramBot } from "./bot-client.js";

/** A reset link works once, for 15 minutes. */
export const RESET_TOKEN_TTL_SECONDS = 15 * 60;

export const RESET_PATH = "/reset";

export interface ResetTokenRequest {
	readonly accountId: string;
	/** Interaction to return to after the reset, when it began in one. */
	readonly interactionUid?: string;
	/** Where the link went (Telegram chat) or who asked (Google/GitHub id). */
	readonly channel?: TokenChannel;
}

export type ResetTokenResult =
	| {
			readonly status: "ok";
			readonly account: AccountDocument;
			/** Security version the token was checked at; the reset write requires it. */
			readonly version: number;
			readonly interactionUid?: string;
	  }
	| { readonly status: "missing" | "stale" };

/**
 * Issues a single-use password reset token (stored hashed, stamped with the
 * account's security version and channel). Undefined if the account is gone.
 */
export async function createPasswordResetToken(
	tokens: AccountTokens,
	request: ResetTokenRequest,
): Promise<string | undefined> {
	const token = randomToken();
	const issued = await tokens.issue(
		"password-reset",
		token,
		request.accountId,
		request.interactionUid ? { interactionUid: request.interactionUid } : {},
		RESET_TOKEN_TTL_SECONDS,
		request.channel,
	);
	return issued ? token : undefined;
}

function toResult(
	result: Awaited<ReturnType<AccountTokens["peek"]>>,
): ResetTokenResult {
	if (result.status !== "ok") return { status: result.status };
	return {
		status: "ok",
		account: result.account,
		version: result.version,
		interactionUid: result.data.interactionUid,
	};
}

/** Valid and unused, without consuming it (to render the form). */
export async function peekPasswordResetToken(
	tokens: AccountTokens,
	token: string,
): Promise<ResetTokenResult> {
	return toResult(await tokens.peek("password-reset", token));
}

/** Consumes the token; a second use, a stale one or a late one gets nothing. */
export async function consumePasswordResetToken(
	tokens: AccountTokens,
	token: string,
): Promise<ResetTokenResult> {
	return toResult(await tokens.take("password-reset", token));
}

export function resetUrl(issuer: string, token: string): string {
	return `${issuer}${RESET_PATH}/${token}`;
}

/**
 * Sends the reset link to the account's linked Telegram chat. Does nothing
 * for accounts without Telegram, and nothing while a security review is
 * pending (only recovery codes and the new password work then); the caller
 * shows the same message either way, so the response reveals nothing.
 */
export async function sendTelegramResetLink(
	bot: TelegramBot,
	tokens: AccountTokens,
	issuer: string,
	account: AccountDocument,
	interactionUid: string | undefined,
): Promise<boolean> {
	const chatId = account.telegram?.chatId;
	if (!chatId || account.disabledAt || account.securityReviewPendingSince) {
		return false;
	}
	const token = await createPasswordResetToken(tokens, {
		accountId: account._id,
		interactionUid,
		channel: { kind: "telegram", chatId },
	});
	if (!token) return false;
	await bot.sendMessage(
		chatId,
		`Có yêu cầu đặt lại mật khẩu cho tài khoản hoandat @${account.username}. Link dùng được một lần trong 15 phút. Nếu không phải bạn, hãy bỏ qua tin nhắn này.`,
		{ text: "Đặt lại mật khẩu", url: resetUrl(issuer, token) },
	);
	return true;
}
