import { Router } from "express";
import { portalRoute } from "../account-portal/portal-session.js";
import type {
	AccountTokenResult,
	AccountTokens,
} from "../accounts/account-tokens.js";
import { randomToken } from "../accounts/one-time-tokens.js";
import type { AccountDocument } from "../accounts/user-model.js";
import { formRateLimit, parseForm } from "../http/form.js";
import type { AppServices } from "../services.js";
import { alertBox, linkButton, pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { sendPage } from "../ui/send-page.js";
import type { TelegramBot } from "./bot-client.js";

/** A link code works once, for 10 minutes. */
export const LINK_CODE_TTL_SECONDS = 10 * 60;

export interface LinkCodeOwner {
	readonly accountId: string;
	/** The IdP session that asked for the code; it must still exist to link. */
	readonly sessionUid: string;
}

/** A code still good to use: its account (current) and the session behind it. */
export interface LinkCodeHolder {
	readonly account: AccountDocument;
	readonly sessionUid: string;
	/** Security version the code was checked at; the link write requires it. */
	readonly version: number;
}

/**
 * New deep-link code for an account, bound to the session that asked for
 * it and to the account's security version; earlier unused codes stop
 * working. 43 base64url characters, within Telegram's 64-character limit
 * for the `start` parameter.
 */
export async function createTelegramLinkCode(
	tokens: AccountTokens,
	owner: LinkCodeOwner,
): Promise<string> {
	await tokens.revokeFor("telegram-link", owner.accountId);
	const code = randomToken();
	await tokens.issue(
		"telegram-link",
		code,
		owner.accountId,
		{ sessionUid: owner.sessionUid },
		LINK_CODE_TTL_SECONDS,
	);
	return code;
}

function toHolder(result: AccountTokenResult): LinkCodeHolder | undefined {
	return result.status === "ok" && result.data.sessionUid
		? {
				account: result.account,
				sessionUid: result.data.sessionUid,
				version: result.version,
			}
		: undefined;
}

/** Who a still-valid code was issued to, without using it. */
export async function peekTelegramLinkCode(
	tokens: AccountTokens,
	code: string,
): Promise<LinkCodeHolder | undefined> {
	return toHolder(await tokens.peek("telegram-link", code));
}

/** Who a code was issued to; consumes the code. */
export async function consumeTelegramLinkCode(
	tokens: AccountTokens,
	code: string,
): Promise<LinkCodeHolder | undefined> {
	return toHolder(await tokens.take("telegram-link", code));
}

export function telegramDeepLink(bot: TelegramBot, code: string): string {
	return `https://t.me/${bot.username}?start=${code}`;
}

/** /account/telegram: start linking (deep link) or unlink. */
export function createTelegramLinkRouter(services: AppServices): Router {
	const router = Router();
	const bot = services.telegram;
	if (!bot) {
		router.use((_req, res) => {
			res.sendStatus(404);
		});
		return router;
	}

	router.post("/*splat", formRateLimit(services.formPostsPerMinute), parseForm);

	router.post(
		"/link",
		portalRoute(
			services,
			async (_req, res, { account, sessionUid }) => {
				const code = await createTelegramLinkCode(services.accountTokens, {
					accountId: account._id,
					sessionUid,
				});
				const body = html`${pageTitle("Liên kết Telegram", "Mở bot hoandat trên Telegram, bấm Start rồi bấm “Xác nhận liên kết” trong 10 phút.")}
<div class="auth-form">
${linkButton(telegramDeepLink(bot, code), "Mở Telegram", "primary", "telegram-deep-link")}
<p class="help">Hoặc gửi lệnh sau cho bot <b>@${bot.username}</b>:</p>
<input class="input" readonly value="/start ${code}" aria-label="Lệnh liên kết" data-id="telegram-start-command">
${alertBox("info", "Link chỉ dùng được một lần. Sau khi bot báo đã liên kết, tải lại trang tài khoản.")}
${linkButton("/account", "Về trang tài khoản", "secondary", "telegram-back")}
</div>`;
				sendPage(
					res,
					renderPage({ title: "Liên kết Telegram", body, host: services.host }),
				);
			},
			{ csrf: true, recentLogin: true },
		),
	);

	router.post(
		"/unlink",
		portalRoute(
			services,
			async (_req, res, { account }) => {
				await services.accounts.links.unsetTelegram(account._id);
				services.logger.info({ accountId: account._id }, "Telegram unlinked");
				res.redirect(303, "/account?notice=telegram-unlinked");
			},
			{ csrf: true, recentLogin: true },
		),
	);
	return router;
}
