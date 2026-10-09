import type { Router } from "express";
import {
	decideUpstreamLogin,
	linkUpstream,
} from "../accounts/account-linking.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import { formRateLimit, queryValue, routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import { sendPage } from "../ui/send-page.js";
import {
	asyncHandler,
	csrfScope,
	loadInteraction,
	loginPath,
	sendInteractionError,
} from "./interaction-helpers.js";
import { REVIEW_NEEDS_PASSWORD_MESSAGE } from "./security-review-routes.js";
import { registerUpstreamFinishRoutes } from "./upstream-finish-routes.js";
import { renderChooseUsername, suggestUsername } from "./upstream-pages.js";
import {
	dropPendingUpstream,
	finishUpstream,
	loadPending,
} from "./upstream-pending.js";
import { startUpstream } from "./upstream-start.js";

const REJECTED: Readonly<Record<string, string>> = {
	"no-verified-email":
		"Tài khoản này chưa có email đã xác minh, nên không dùng để đăng nhập hoandat được.",
	disabled: "Tài khoản hoandat này đã bị khoá.",
	"other-provider-account":
		"Email này thuộc một tài khoản hoandat đã liên kết với tài khoản khác của cùng nhà cung cấp. Đăng nhập bằng mật khẩu hoặc tài khoản đã liên kết.",
};

/**
 * Google/GitHub inside an interaction: start (sign-in or "forgot password"),
 * then apply the linking rules to the profile the callback stored.
 */
export function registerUpstreamInteractionRoutes(
	router: Router,
	services: AppServices,
): void {
	router.get(
		"/:uid/upstream/:provider",
		// Each start stores a state document: budget it like a form post.
		formRateLimit(services.formPostsPerMinute),
		asyncHandler(async (req, res) => {
			const name = routeParam(req, "provider");
			const client = isUpstreamProvider(name)
				? services.upstreams.get(name)
				: undefined;
			if (!client) {
				res.sendStatus(404);
				return;
			}
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			const purpose =
				queryValue(req, "purpose") === "reset" ? "reset" : "login";
			await startUpstream(services, res, client, purpose, {
				uid: interaction.uid,
			});
		}),
	);

	router.get(
		"/:uid/upstream",
		asyncHandler(async (req, res) => {
			const pending = await loadPending(services, req, res);
			if (!pending) return;
			const { interaction, profile } = pending;
			const decision = await decideUpstreamLogin(services.accounts, profile);
			const csrf = services.csrf.token(req, res, csrfScope(interaction.uid));
			const base = {
				host: services.host,
				uid: interaction.uid,
				csrf,
				provider: profile.provider,
			};
			// While a reset awaits its review, no provider may sign in or be
			// linked: only the new password leads to the review.
			if (
				(decision.kind === "login" || decision.kind === "auto-link") &&
				decision.account.securityReviewPendingSince
			) {
				await dropPendingUpstream(services, interaction.uid);
				sendInteractionError(
					services,
					res,
					REVIEW_NEEDS_PASSWORD_MESSAGE,
					403,
					{
						href: loginPath(interaction.uid),
						label: "Đăng nhập bằng mật khẩu",
					},
				);
				await services.audit.record(
					"login.failed",
					decision.account._id,
					{
						method: "federated",
						reason: "review-pending",
						provider: profile.provider,
					},
					auditContext(req),
				);
				return;
			}
			switch (decision.kind) {
				case "login":
					await finishUpstream(
						services,
						req,
						res,
						interaction,
						decision.account._id,
					);
					return;
				case "auto-link": {
					// Conditioned on the account the decision was made from.
					const write = await linkUpstream(
						services.accounts,
						decision.account,
						profile,
						decision.account.securityVersion ?? 0,
					);
					if (!write.applied) {
						res.redirect(303, `/interaction/${interaction.uid}/upstream`);
						return;
					}
					notifyTelegram(
						services,
						decision.account,
						`Tài khoản hoandat @${decision.account.username} vừa được liên kết với ${UPSTREAM_LABELS[profile.provider]}. Nếu không phải bạn, hãy đổi mật khẩu và huỷ liên kết ở trang tài khoản.`,
					);
					services.logger.info(
						{ accountId: decision.account._id, provider: profile.provider },
						"Provider linked by verified email",
					);
					await finishUpstream(
						services,
						req,
						res,
						interaction,
						decision.account._id,
					);
					return;
				}
				case "signup":
					sendPage(
						res,
						renderChooseUsername({
							...base,
							email: decision.email,
							reclaiming: decision.reclaimsFrom !== undefined,
							suggestion: suggestUsername(decision.email),
						}),
					);
					return;
				case "rejected":
					await dropPendingUpstream(services, interaction.uid);
					sendInteractionError(
						services,
						res,
						REJECTED[decision.reason] ?? "Không đăng nhập được.",
						403,
						{
							href: `/interaction/${interaction.uid}`,
							label: "Quay lại đăng nhập",
						},
					);
			}
		}),
	);

	registerUpstreamFinishRoutes(router, services);
}
