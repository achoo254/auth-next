import { Router } from "express";
import { afterPasswordChange } from "../account-portal/after-password-change.js";
import { hashSecret, passwordProblem } from "../accounts/password-hasher.js";
import type { AccountDocument } from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import {
	formRateLimit,
	formValue,
	parseForm,
	routeParam,
} from "../http/form.js";
import type { AppServices } from "../services.js";
import {
	consumePasswordResetToken,
	peekPasswordResetToken,
} from "../telegram/reset-link-service.js";
import {
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { sendPage } from "../ui/send-page.js";
import {
	asyncHandler,
	checkCsrf,
	sendInteractionError,
} from "./interaction-helpers.js";
import {
	registerResetReviewRoutes,
	startResetReview,
} from "./reset-review-routes.js";

const EXPIRED_MESSAGE =
	"Link đặt lại mật khẩu đã hết hạn hoặc đã được dùng. Yêu cầu link mới ở trang quên mật khẩu.";

function renderResetForm(
	host: string,
	token: string,
	csrf: string,
	username: string,
	error?: string,
): string {
	const body = html`${pageTitle("Đặt mật khẩu mới", html`Cho tài khoản <b data-id="reset-username">@${username}</b>. Mọi phiên đăng nhập, thiết bị và ứng dụng khác của tài khoản sẽ bị đăng xuất.`)}
${maybeAlert("error", error)}
<form class="auth-form" method="post" action="/reset/${token}" novalidate>
${csrfField(csrf)}
${inputField({ name: "password", label: "Mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256, autofocus: true, help: "Ít nhất 7 ký tự." })}
${inputField({ name: "password_confirm", label: "Nhập lại mật khẩu mới", type: "password", autocomplete: "new-password", minlength: 7, maxlength: 256 })}
${submitButton("Đặt mật khẩu", { block: true, dataId: "reset-submit" })}
</form>`;
	return renderPage({ title: "Đặt mật khẩu mới", body, host });
}

/**
 * /reset/:token — the page behind a Telegram reset link or a Google/GitHub
 * recovery. Not tied to an interaction: the link may open in another
 * browser (e.g. Telegram's). The token is single-use and lives 15 minutes.
 */
export function createResetRouter(services: AppServices): Router {
	const router = Router();
	// Before "/:token", which would otherwise also match "/review".
	registerResetReviewRoutes(router, services);
	const scope = (token: string): string => `reset:${token}`;
	/** The account a still-valid token resets, without consuming it. */
	const accountFor = async (
		token: string,
	): Promise<AccountDocument | undefined> => {
		const result = await peekPasswordResetToken(services.accountTokens, token);
		return result.status === "ok" ? result.account : undefined;
	};

	router.get(
		"/:token",
		asyncHandler(async (req, res) => {
			const token = routeParam(req, "token");
			const account = await accountFor(token);
			if (!account) {
				sendInteractionError(services, res, EXPIRED_MESSAGE, 410);
				return;
			}
			sendPage(
				res,
				renderResetForm(
					services.host,
					token,
					services.csrf.token(req, res, scope(token)),
					account.username,
				),
			);
		}),
	);

	router.post(
		"/:token",
		formRateLimit(services.formPostsPerMinute),
		parseForm,
		asyncHandler(async (req, res) => {
			const token = routeParam(req, "token");
			if (!checkCsrf(services, req, res, scope(token))) return;
			const password = formValue(req, "password") ?? "";
			const problem =
				passwordProblem(password) ??
				(password === formValue(req, "password_confirm")
					? undefined
					: "Hai mật khẩu không khớp nhau.");
			if (problem) {
				const pending = await accountFor(token);
				if (!pending) {
					sendInteractionError(services, res, EXPIRED_MESSAGE, 410);
					return;
				}
				sendPage(
					res,
					renderResetForm(
						services.host,
						token,
						services.csrf.token(req, res, scope(token)),
						pending.username,
						problem,
					),
					400,
				);
				return;
			}
			// Missing, used, expired, or issued before a security change (e.g.
			// the owner removed the Telegram chat it was sent to): all 410.
			const result = await consumePasswordResetToken(
				services.accountTokens,
				token,
			);
			if (result.status !== "ok") {
				sendInteractionError(services, res, EXPIRED_MESSAGE, 410);
				return;
			}
			const { account, interactionUid } = result;
			// Only if nothing changed since the token was checked above.
			const write = await services.accounts.setPassword(
				account._id,
				await hashSecret(password),
				result.version,
			);
			if (!write.applied) {
				sendInteractionError(services, res, EXPIRED_MESSAGE, 410);
				return;
			}
			// The link may have been used by whoever took over the account:
			// every session and grant goes, including any in this browser.
			await afterPasswordChange(
				services,
				account,
				"reset-link",
				{ grants: true },
				auditContext(req),
			);
			// Straight on to the security review, in this same browser.
			await startResetReview(services, res, account._id, interactionUid);
		}),
	);
	return router;
}
