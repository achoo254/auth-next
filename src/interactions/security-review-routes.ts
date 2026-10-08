import type { Request, Response, Router } from "express";
import { auditContext } from "../audit/audit-context.js";
import type { AppServices } from "../services.js";
import {
	type Interaction,
	csrfScope,
	finishLogin,
	loadInteraction,
	sendInteractionError,
} from "./interaction-helpers.js";
import { registerReviewActions } from "./security-review-actions.js";

const REVIEW_TTL_SECONDS = 30 * 60;

/** Shown when a pending review is reached any way other than the new password. */
export const REVIEW_NEEDS_PASSWORD_MESSAGE =
	"Tài khoản vừa được đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới để rà soát bảo mật.";

/** True when this sign-in proved the password (amr "pwd"). */
function provedPassword(amr: readonly string[]): boolean {
	return amr.includes("pwd");
}

/**
 * Finishes a sign-in, unless the account owes a security review (after a
 * password reset). Then only a sign-in that proved the *new* password,
 * which only the person who reset knows, is parked and sent to the review;
 * any other way in (Google, GitHub: possibly added by an intruder) is
 * refused until the review is done. Every completed sign-in goes through
 * here.
 */
export async function completeLogin(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	accountId: string,
	amr: readonly string[],
): Promise<void> {
	const account = await services.accounts.findActiveById(accountId);
	if (account?.securityReviewPendingSince) {
		if (!provedPassword(amr)) {
			services.logger.warn(
				{ accountId, amr },
				"Sign-in refused while a security review is pending",
			);
			sendInteractionError(services, res, REVIEW_NEEDS_PASSWORD_MESSAGE, 403, {
				href: `/interaction/${interaction.uid}`,
				label: "Đăng nhập bằng mật khẩu",
			});
			await services.audit.record(
				"login.failed",
				accountId,
				{ method: "federated", reason: "review-pending" },
				auditContext(req),
			);
			return;
		}
		await services.accountTokens.issue(
			"review-pending",
			interaction.uid,
			accountId,
			{ amr: amr.join(" ") },
			REVIEW_TTL_SECONDS,
		);
		res.redirect(303, `/interaction/${interaction.uid}/review`);
		return;
	}
	await finishLogin(services, req, res, accountId, amr);
}

/**
 * /interaction/:uid/review: the review for a login parked by completeLogin,
 * reachable only from the browser holding that interaction.
 */
export function registerSecurityReviewRoutes(
	router: Router,
	services: AppServices,
): void {
	registerReviewActions(
		router,
		services,
		"/:uid/review",
		async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return undefined;
			const uid = interaction.uid;
			const parked = await services.accountTokens.peek("review-pending", uid);
			if (
				parked.status !== "ok" ||
				!provedPassword((parked.data.amr ?? "").split(" "))
			) {
				res.redirect(303, `/interaction/${uid}`);
				return undefined;
			}
			const accountId = parked.account._id;
			return {
				account: parked.account,
				version: parked.version,
				data: parked.data,
				base: `/interaction/${uid}/review`,
				csrfScope: csrfScope(uid),
				keepSessionUid: interaction.session?.uid,
				renew: (produced) =>
					services.accountTokens.renew(
						"review-pending",
						uid,
						accountId,
						produced,
					),
				consume: async () => {
					await services.accountTokens.take("review-pending", uid);
				},
			};
		},
		async (req, res, review) => {
			const amr = (review.data.amr ?? "pwd").split(" ").filter(Boolean);
			await finishLogin(services, req, res, review.account._id, amr);
		},
	);
}
