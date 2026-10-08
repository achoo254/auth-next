import { Router } from "express";
import { auditContext } from "../audit/audit-context.js";
import { recordFailedLogin } from "../audit/record-login.js";
import { formRateLimit, formText, formValue, parseForm } from "../http/form.js";
import type { AppServices } from "../services.js";
import { completeConsent, showConsent } from "./consent-handler.js";
import { registerForgotRoutes } from "./forgot-routes.js";
import {
	asyncHandler,
	checkCsrf,
	csrfScope,
	loadInteraction,
	sendInteractionError,
} from "./interaction-helpers.js";
import {
	BAD_CREDENTIALS_MESSAGE,
	LOCKED_MESSAGE,
	checkPassword,
	normalizeIdentifier,
	showLogin,
	throttleSubject,
} from "./login-handler.js";
import {
	completeLogin,
	registerSecurityReviewRoutes,
} from "./security-review-routes.js";
import { registerSignupRoutes } from "./signup-routes.js";
import { registerUpstreamInteractionRoutes } from "./upstream-routes.js";

/**
 * Login, consent and the rest of the interaction pages under
 * /interaction/:uid. Every POST checks CSRF; every POST is rate-limited per
 * IP on top of the per-account lockout kept in MongoDB.
 */
export function createInteractionRouter(services: AppServices): Router {
	const router = Router();
	router.post(
		"/:uid/*splat",
		formRateLimit(services.formPostsPerMinute),
		parseForm,
	);

	router.get(
		"/:uid",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (interaction.prompt.name === "login") {
				await showLogin(services, req, res, interaction);
				return;
			}
			if (interaction.prompt.name === "consent") {
				await showConsent(services, req, res, interaction);
				return;
			}
			sendInteractionError(
				services,
				res,
				"Bước đăng nhập này chưa được hỗ trợ.",
			);
		}),
	);

	router.post(
		"/:uid/login",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const rawIdentifier = formText(req, "identifier", 254);
			const identifier = normalizeIdentifier(rawIdentifier);
			const password = formValue(req, "password") ?? "";
			const account = identifier
				? await services.accounts.findByIdentifier(identifier)
				: undefined;
			const result = await checkPassword(
				services.passwordThrottle,
				throttleSubject(services, req, identifier, account),
				account,
				password,
			);
			if (!result.ok) {
				const locked = result.reason === "locked";
				await showLogin(services, req, res, interaction, {
					error: locked ? LOCKED_MESSAGE : BAD_CREDENTIALS_MESSAGE,
					identifier: rawIdentifier,
					status: locked ? 429 : 401,
				});
				// After the response, so known and unknown identifiers answer
				// in the same time; refusals by a lock checked nothing.
				if (account && result.reason === "invalid") {
					await recordFailedLogin(
						services,
						account._id,
						"password",
						result.accountLocked,
						auditContext(req),
					);
				}
				return;
			}
			await completeLogin(services, req, res, interaction, result.account._id, [
				"pwd",
			]);
		}),
	);

	router.post(
		"/:uid/consent",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const accountId = interaction.session?.accountId;
			if (interaction.prompt.name !== "consent" || !accountId) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			await completeConsent(services, req, res, interaction, accountId);
		}),
	);

	router.post(
		"/:uid/abort",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			await services.provider.interactionFinished(
				req,
				res,
				{
					error: "access_denied",
					error_description: "End-User aborted interaction",
				},
				{ mergeWithLastSubmission: false },
			);
		}),
	);

	registerSignupRoutes(router, services);
	registerSecurityReviewRoutes(router, services);
	registerForgotRoutes(router, services);
	registerUpstreamInteractionRoutes(router, services);
	return router;
}
