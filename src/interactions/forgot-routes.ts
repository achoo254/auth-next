import type { Request, Response, Router } from "express";
import { afterPasswordChange } from "../account-portal/after-password-change.js";
import { hashSecret, passwordProblem } from "../accounts/password-hasher.js";
import { findRecoveryCodeHash } from "../accounts/recovery-codes.js";
import { auditContext } from "../audit/audit-context.js";
import { recordFailedLogin } from "../audit/record-login.js";
import { formText, formValue } from "../http/form.js";
import type { AppServices } from "../services.js";
import { sendTelegramResetLink } from "../telegram/reset-link-service.js";
import { sendPage } from "../ui/send-page.js";
import { renderForgot } from "./forgot-password-page.js";
import {
	type Interaction,
	asyncHandler,
	checkCsrf,
	csrfScope,
	loadInteraction,
} from "./interaction-helpers.js";
import {
	LOCKED_MESSAGE,
	normalizeIdentifier,
	throttleSubject,
} from "./login-handler.js";
import { completeLogin } from "./security-review-routes.js";

export const TELEGRAM_SENT_MESSAGE =
	"Nếu tài khoản tồn tại và đã liên kết Telegram, bot hoandat vừa gửi link đặt lại mật khẩu. Link dùng được một lần trong 15 phút.";
const BAD_RECOVERY_MESSAGE = "Email/username hoặc mã khôi phục không đúng.";

function showForgot(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	extra: {
		error?: string;
		notice?: string;
		identifier?: string;
		status?: number;
	} = {},
): void {
	sendPage(
		res,
		renderForgot({
			host: services.host,
			uid: interaction.uid,
			csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
			providers: [...services.upstreams.keys()],
			telegramEnabled: services.telegram !== undefined,
			...extra,
		}),
		extra.status,
	);
}

export function registerForgotRoutes(
	router: Router,
	services: AppServices,
): void {
	router.get(
		"/:uid/forgot",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (interaction) showForgot(services, req, res, interaction);
		}),
	);

	router.post(
		"/:uid/forgot/recovery",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const rawIdentifier = formText(req, "identifier", 254);
			const identifier = normalizeIdentifier(rawIdentifier);
			const password = formValue(req, "password") ?? "";
			const problem =
				passwordProblem(password) ??
				(password === formValue(req, "password_confirm")
					? undefined
					: "Hai mật khẩu không khớp nhau.");
			if (problem) {
				showForgot(services, req, res, interaction, {
					error: problem,
					identifier: rawIdentifier,
					status: 400,
				});
				return;
			}
			const account = identifier
				? await services.accounts.findByIdentifier(identifier)
				: undefined;
			const subject = throttleSubject(services, req, identifier, account);
			// Reserved before any argon2 work, so parallel guesses share the budget.
			const reservation = await services.recoveryThrottle.reserve(subject);
			if (!reservation) {
				showForgot(services, req, res, interaction, {
					error: LOCKED_MESSAGE,
					identifier: rawIdentifier,
					status: 429,
				});
				return;
			}
			const usable = account && !account.disabledAt ? account : undefined;
			const matched = await findRecoveryCodeHash(
				usable?.recoveryCodeHashes ?? [],
				formText(req, "code", 20),
			);
			const consumed =
				usable !== undefined &&
				matched !== undefined &&
				(await services.accounts.consumeRecoveryCode(usable._id, matched));
			if (!usable || !consumed) {
				const { accountLocked } = await reservation.fail();
				showForgot(services, req, res, interaction, {
					error: BAD_RECOVERY_MESSAGE,
					identifier: rawIdentifier,
					status: 401,
				});
				// After the response, as for passwords (same timing either way).
				if (account) {
					await recordFailedLogin(
						services,
						account._id,
						"recovery-code",
						accountLocked,
						auditContext(req),
					);
				}
				return;
			}
			await reservation.succeed();
			await services.accounts.setPassword(
				usable._id,
				await hashSecret(password),
			);
			// A reset means someone may have had the old password: everything
			// else signed in as this account is signed out, every grant revoked.
			await afterPasswordChange(
				services,
				usable,
				"recovery-code",
				{ exceptSessionUid: interaction.session?.uid, grants: true },
				auditContext(req),
			);
			await completeLogin(services, req, res, interaction, usable._id, ["pwd"]);
		}),
	);

	router.post(
		"/:uid/forgot/telegram",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			const bot = services.telegram;
			if (!bot) {
				res.sendStatus(404);
				return;
			}
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const rawIdentifier = formText(req, "identifier", 254);
			const identifier = normalizeIdentifier(rawIdentifier);
			const account = identifier
				? await services.accounts.findByIdentifier(identifier)
				: undefined;
			// Each request uses one of three sends per 15 minutes; once used
			// up, requests are refused without extending the window.
			const allowed =
				identifier !== "" &&
				(await services.telegramResetThrottle.reserve(
					// No device exemption: a cookie must not lift the send limit.
					throttleSubject(services, req, identifier, account, {
						deviceExemption: false,
					}),
				)) !== undefined;
			if (allowed && account) {
				// Sent in the background: the answer is identical and equally fast
				// whether or not the account exists or has Telegram linked.
				sendTelegramResetLink(
					bot,
					services.accountTokens,
					services.issuer,
					account,
					interaction.uid,
				).catch((error: unknown) => {
					services.logger.warn({ err: error }, "Telegram reset link not sent");
				});
			}
			showForgot(services, req, res, interaction, {
				notice: TELEGRAM_SENT_MESSAGE,
				identifier: rawIdentifier,
			});
		}),
	);
}
