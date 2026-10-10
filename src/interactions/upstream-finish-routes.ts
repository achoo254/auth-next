import type { Router } from "express";
import { AccountConflictError } from "../accounts/account-conflicts.js";
import { decideUpstreamLogin } from "../accounts/account-linking.js";
import { providerDetail } from "../accounts/account-links.js";
import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import { isValidUsername, normalizeUsername } from "../accounts/user-model.js";
import { formText } from "../http/form.js";
import type { AppServices } from "../services.js";
import { notifyTelegram } from "../telegram/notify.js";
import { sendPage } from "../ui/send-page.js";
import { asyncHandler, checkCsrf, csrfScope } from "./interaction-helpers.js";
import { renderChooseUsername } from "./upstream-pages.js";
import { finishUpstream, loadPending } from "./upstream-pending.js";

/**
 * Finishes a Google/GitHub sign-up: the username for the new account. When
 * an account held this email unverified, the email moves to the new account
 * (its proven owner); the old account keeps its other sign-in methods.
 */
export function registerUpstreamFinishRoutes(
	router: Router,
	services: AppServices,
): void {
	router.post(
		"/:uid/upstream/signup",
		asyncHandler(async (req, res) => {
			const pending = await loadPending(services, req, res);
			if (!pending) return;
			const { interaction, profile } = pending;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const decision = await decideUpstreamLogin(services.accounts, profile);
			if (decision.kind !== "signup") {
				res.redirect(303, `/interaction/${interaction.uid}/upstream`);
				return;
			}
			const username = normalizeUsername(formText(req, "username", 64));
			const retry = (error: string, status: number): void => {
				sendPage(
					res,
					renderChooseUsername({
						host: services.host,
						uid: interaction.uid,
						csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
						provider: profile.provider,
						email: decision.email,
						reclaiming: decision.reclaimsFrom !== undefined,
						suggestion: username,
						error,
					}),
					status,
				);
			};
			const taken = "Username này đã có người dùng. Chọn username khác.";
			if (!isValidUsername(username)) {
				retry(
					"Username cần 3–30 ký tự gồm chữ thường, số hoặc dấu gạch dưới.",
					400,
				);
				return;
			}
			if (await services.accounts.usernameTaken(username)) {
				retry(taken, 409);
				return;
			}
			if (decision.reclaimsFrom) {
				const previous = await services.accounts.links.reclaimEmail(
					decision.email,
				);
				services.logger.info(
					{ fromAccountId: previous?._id, provider: profile.provider },
					"Unverified email reclaimed by its verified owner",
				);
				notifyTelegram(
					services,
					previous,
					`Email ${decision.email} đã được gỡ khỏi tài khoản hoandat @${previous?.username ?? ""} vì người sở hữu email đã xác minh nó qua ${UPSTREAM_LABELS[profile.provider]}. Bạn vẫn đăng nhập được bằng Google/GitHub đã liên kết với tài khoản đó.`,
				);
			}
			try {
				const account = await services.accounts.create({
					username,
					email: decision.email,
					emailVerifiedBy: profile.provider,
					providers: { [profile.provider]: profile.providerId },
					providerDetails: { [profile.provider]: providerDetail(profile) },
					name: profile.name,
					picture: profile.picture,
				});
				services.logger.info(
					{ accountId: account._id, provider: profile.provider },
					"Account created via provider",
				);
				await finishUpstream(services, req, res, interaction, account._id);
			} catch (error) {
				if (!(error instanceof AccountConflictError)) throw error;
				// Say which field: a parallel sign-up may have taken either.
				retry(
					error.field === "email"
						? "Email này vừa được dùng cho một tài khoản khác. Hãy đăng nhập bằng tài khoản đó."
						: taken,
					409,
				);
			}
		}),
	);
}
