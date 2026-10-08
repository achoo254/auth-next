import type { AccountDocument } from "../accounts/user-model.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import { type RevokeScope, revokeAccountAccess } from "./revoke-access.js";

/**
 * Everything that follows a new password, whoever set it: pending one-time
 * tokens die, login locks lift, other sessions (and, per `scope`, every grant) are
 * revoked, a reset starts the mandatory security review, and the owner
 * hears about it on Telegram.
 */
export async function afterPasswordChange(
	services: AppServices,
	account: AccountDocument,
	via: "recovery-code" | "reset-link" | "account-page",
	scope: RevokeScope,
): Promise<void> {
	// Every pending one-time token of the account dies: other reset links,
	// Telegram link codes, half-finished Google/GitHub links. The token of
	// the flow that got here was already consumed.
	await services.tokens.revokeAllFor(account._id);
	await services.passwordThrottle.clear(
		[account._id, account.username, account.email].filter(
			(id): id is string => id !== undefined,
		),
	);
	const revoked = await revokeAccountAccess(services, account._id, scope);
	// A reset (not a change made while signed in) means someone else may
	// have added a way back in: the owner must review before going on.
	if (via !== "account-page") {
		await services.accounts.setSecurityReviewPending(account._id, true);
	}
	services.logger.info(
		{ accountId: account._id, via, revoked },
		"Password changed",
	);
	notifyTelegram(
		services,
		account,
		`Mật khẩu tài khoản hoandat @${account.username} vừa được ${via === "account-page" ? "đổi" : "đặt lại"}. Nếu không phải bạn, hãy dùng mã khôi phục hoặc Google/GitHub đã liên kết để lấy lại tài khoản ngay.`,
	);
}
