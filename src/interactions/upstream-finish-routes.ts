import type { Router } from "express";
import { AccountConflictError } from "../accounts/account-conflicts.js";
import { decideUpstreamLogin } from "../accounts/account-linking.js";
import { providerDetail } from "../accounts/provider-link.js";
import { isValidUsername, normalizeUsername } from "../accounts/user-model.js";
import { formText } from "../http/form.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	asyncHandler,
	checkCsrf,
	csrfScope,
	interactionPage,
} from "./interaction-helpers.js";
import { renderChooseUsername } from "./upstream-pages.js";
import { finishUpstream, loadPending } from "./upstream-pending.js";

/**
 * Finishes a Google/GitHub/Apple sign-up: the username for the new account. When
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
			const page = interactionPage(req, interaction);
			const retry = (error: MessageKey, status: number): void => {
				sendPage(
					res,
					renderChooseUsername({
						page,
						uid: interaction.uid,
						csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
						provider: profile.provider,
						email: decision.email,
						reclaiming: decision.reclaimsFrom !== undefined,
						suggestion: username,
						error: page.i18n.t(error),
					}),
					status,
				);
			};
			const taken = "username.taken";
			if (!isValidUsername(username)) {
				retry("username.invalid", 400);
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
				notifyAccount(
					services,
					previous,
					{ kind: "email-reclaimed", provider: profile.provider },
					{ reclaimedEmail: decision.email },
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
				await finishUpstream(
					services,
					req,
					res,
					interaction,
					account._id,
					profile,
				);
			} catch (error) {
				if (!(error instanceof AccountConflictError)) throw error;
				// Say which field: a parallel sign-up may have taken either.
				retry(error.field === "email" ? "username.emailTaken" : taken, 409);
			}
		}),
	);
}
