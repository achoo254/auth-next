import type { Response, Router } from "express";
import { randomToken } from "../accounts/one-time-tokens.js";
import { formRateLimit, parseForm, readCookie } from "../http/form.js";
import type { AppServices } from "../services.js";
import { alertBox, linkButton, pageTitle } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { sendPage } from "../ui/send-page.js";
import { sendInteractionError } from "./interaction-helpers.js";
import { registerReviewActions } from "./security-review-actions.js";
import { REVIEW_NEEDS_PASSWORD_MESSAGE } from "./security-review-routes.js";

const REVIEW_TTL_SECONDS = 30 * 60;
const REVIEW_PATH = "/reset/review";

function cookieName(services: AppServices): string {
	return services.issuer.startsWith("https:")
		? "__Host-reset_review"
		: "reset_review";
}

function cookieOptions(services: AppServices): {
	httpOnly: true;
	sameSite: "lax";
	secure: boolean;
	path: string;
} {
	return {
		httpOnly: true,
		sameSite: "lax",
		secure: services.issuer.startsWith("https:"),
		path: "/",
	};
}

/**
 * Right after a reset link set a new password, sends the same browser
 * straight to the security review: a single-use token in an HttpOnly cookie
 * stands for "this browser just reset the password" for 30 minutes.
 */
export async function startResetReview(
	services: AppServices,
	res: Response,
	accountId: string,
	interactionUid: string | undefined,
): Promise<void> {
	const token = randomToken();
	await services.accountTokens.issue(
		"review-reset",
		token,
		accountId,
		interactionUid ? { interactionUid } : {},
		REVIEW_TTL_SECONDS,
	);
	res.cookie(cookieName(services), token, {
		...cookieOptions(services),
		maxAge: REVIEW_TTL_SECONDS * 1000,
	});
	res.redirect(303, REVIEW_PATH);
}

/** /reset/review: the review for the browser that just used a reset link. */
export function registerResetReviewRoutes(
	router: Router,
	services: AppServices,
): void {
	router.post(
		"/review/*splat",
		formRateLimit(services.formPostsPerMinute),
		parseForm,
	);
	registerReviewActions(
		router,
		services,
		"/review",
		async (req, res) => {
			const token = readCookie(req, cookieName(services)) ?? "";
			const result = token
				? await services.accountTokens.peek("review-reset", token)
				: undefined;
			if (result?.status !== "ok") {
				sendInteractionError(
					services,
					res,
					REVIEW_NEEDS_PASSWORD_MESSAGE,
					403,
					{
						href: "/account",
						label: "Đăng nhập",
					},
				);
				return undefined;
			}
			const { account } = result;
			if (!account.securityReviewPendingSince) {
				res.redirect(303, "/account");
				return undefined;
			}
			return {
				account,
				version: result.version,
				data: result.data,
				base: REVIEW_PATH,
				csrfScope: `review-reset:${token}`,
				renew: (produced) =>
					services.accountTokens.renew(
						"review-reset",
						token,
						account._id,
						produced,
					),
				consume: async () => {
					await services.accountTokens.take("review-reset", token);
				},
			};
		},
		async (_req, res, review) => {
			res.clearCookie(cookieName(services), cookieOptions(services));
			const next = review.data.interactionUid
				? linkButton(
						`/interaction/${review.data.interactionUid}`,
						"Tiếp tục đăng nhập",
						"primary",
						"review-continue-login",
					)
				: linkButton(
						"/account",
						"Đăng nhập",
						"primary",
						"review-continue-account",
					);
			const body = html`${pageTitle("Đã rà soát xong")}
${alertBox("success", html`Tài khoản <b>@${review.account.username}</b> đã sẵn sàng. Đăng nhập bằng mật khẩu mới để tiếp tục.`)}
<div class="auth-form">${next}</div>`;
			sendPage(
				res,
				renderPage({ title: "Đã rà soát xong", body, host: services.host }),
			);
		},
	);
}
