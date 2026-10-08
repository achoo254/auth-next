import type { Request, Response, Router } from "express";
import { revokeAccountAccess } from "../account-portal/revoke-access.js";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import type { GuardedWrite } from "../accounts/versioned-write.js";
import { routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import { asyncHandler, sendInteractionError } from "./interaction-helpers.js";
import {
	type LoadReview,
	REVIEW_EXPIRED_MESSAGE,
	type ReviewContext,
} from "./security-review-context.js";
import { renderSecurityReview } from "./security-review-page.js";
import { renderRecoveryCodes } from "./signup-page.js";

export type { LoadReview, ReviewContext };

/**
 * The "Rà soát bảo mật" page and its actions, mounted at `path` for one way
 * of reaching it (a parked password login, or the browser that just reset
 * the password). `load` decides who may be here; `done` continues once the
 * owner confirms.
 */
export function registerReviewActions(
	router: Router,
	services: AppServices,
	path: string,
	load: LoadReview,
	done: (req: Request, res: Response, review: ReviewContext) => Promise<void>,
): void {
	/** Loads the review and, for posts, checks the form's CSRF token. */
	const loadChecked = async (
		req: Request,
		res: Response,
	): Promise<ReviewContext | undefined> => {
		const review = await load(req, res);
		if (!review || req.method !== "POST") return review;
		if (services.csrf.verify(req, review.csrfScope)) return review;
		sendInteractionError(
			services,
			res,
			"Biểu mẫu đã hết hạn. Tải lại trang rồi thử lại.",
			403,
		);
		return undefined;
	};
	/** The account changed under the review (another change slipped in). */
	const expired = (res: Response): void => {
		sendInteractionError(services, res, REVIEW_EXPIRED_MESSAGE, 410);
	};
	/** After a guarded write: keep going, or answer 410 if it was refused as stale. */
	const settle = async (
		res: Response,
		review: ReviewContext,
		write: GuardedWrite,
	): Promise<boolean> => {
		if (write.applied) {
			if (await review.renew(write.version)) return true;
			expired(res);
			return false;
		}
		if (write.stale) {
			expired(res);
			return false;
		}
		return true;
	};
	const action = (
		suffix: string,
		handler: (
			req: Request,
			res: Response,
			review: ReviewContext,
		) => Promise<void>,
	): void => {
		router.post(
			`${path}/${suffix}`,
			asyncHandler(async (req, res) => {
				const review = await loadChecked(req, res);
				if (review) await handler(req, res, review);
			}),
		);
	};

	router.get(
		path,
		asyncHandler(async (req, res) => {
			const review = await loadChecked(req, res);
			if (!review) return;
			sendPage(
				res,
				renderSecurityReview({
					host: services.host,
					csrf: services.csrf.token(req, res, review.csrfScope),
					base: review.base,
					account: review.account,
				}),
			);
		}),
	);

	action("unlink/:provider", async (req, res, review) => {
		const provider = routeParam(req, "provider");
		if (isUpstreamProvider(provider)) {
			const write = await services.accounts.links.unlinkProvider(
				review.account._id,
				provider,
				review.version,
			);
			if (!(await settle(res, review, write))) return;
		}
		res.redirect(303, review.base);
	});

	action("telegram/unlink", async (_req, res, review) => {
		const write = await services.accounts.links.unsetTelegram(
			review.account._id,
			review.version,
		);
		if (await settle(res, review, write)) res.redirect(303, review.base);
	});

	action("recovery-codes", async (req, res, review) => {
		const recovery = await generateRecoveryCodes();
		const write = await services.accounts.replaceRecoveryCodes(
			review.account._id,
			recovery.hashes,
			review.version,
		);
		if (!write.applied || !(await review.renew(write.version))) {
			expired(res);
			return;
		}
		sendPage(
			res,
			renderRecoveryCodes({
				host: services.host,
				csrf: services.csrf.token(req, res, review.csrfScope),
				action: `${review.base}/codes-saved`,
				username: review.account.username,
				codes: recovery.codes,
				continueLabel: "Quay lại rà soát",
				intro:
					"Bộ mã cũ đã hết hiệu lực. Mỗi mã dưới đây dùng được một lần để đặt lại mật khẩu.",
			}),
		);
	});

	action("codes-saved", async (_req, res, review) => {
		res.redirect(303, review.base);
	});

	action("done", async (req, res, review) => {
		// Ends the review only if nothing changed since the token was checked;
		// this also raises the security version, so any token issued while it
		// was pending is dead from here on.
		const write = await services.accounts.setSecurityReviewPending(
			review.account._id,
			false,
			review.version,
		);
		if (!write.applied) {
			expired(res);
			return;
		}
		await review.consume();
		// A sign-in that passed its password check just before the reset could
		// have created a session or grant just after it: sweep once more.
		await revokeAccountAccess(services, review.account._id, {
			exceptSessionUid: review.keepSessionUid,
			grants: true,
		});
		services.logger.info(
			{ accountId: review.account._id },
			"Security review confirmed",
		);
		await done(req, res, review);
	});
}
