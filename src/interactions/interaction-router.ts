import { Router } from "express";
import { formRateLimit, parseForm } from "../http/form.js";
import { CREATE_PROMPT } from "../oidc/interaction-policy.js";
import type { AppServices } from "../services.js";
import { completeConsent, showConsent } from "./consent-handler.js";
import {
	asyncHandler,
	checkCsrf,
	csrfScope,
	isSignInPrompt,
	loadInteraction,
	sendInteractionError,
} from "./interaction-helpers.js";
import { showLogin, showSignup } from "./login-handler.js";
import { registerReviewLoginRoutes } from "./review-login-routes.js";
import { registerUpstreamInteractionRoutes } from "./upstream-routes.js";

/**
 * Login, consent and the rest of the interaction pages under
 * /interaction/:uid. Signing in is through Google, GitHub or Apple (see
 * upstream-routes.ts), plus the review-only sign-in when it is on
 * (review-login-routes.ts, ADR 0010). Every POST checks CSRF and is rate-limited per IP.
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
			// prompt=create (OIDC Prompt Create): sign-up first.
			if (interaction.prompt.name === CREATE_PROMPT) {
				showSignup(services, req, res, interaction);
				return;
			}
			if (interaction.prompt.name === "consent") {
				await showConsent(services, req, res, interaction);
				return;
			}
			sendInteractionError(services, res, {
				message: "error.unsupportedStep",
			});
		}),
	);

	// "Already have an account? Sign in" from the sign-up page, same interaction.
	router.get(
		"/:uid/login",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!isSignInPrompt(interaction)) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			await showLogin(services, req, res, interaction);
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

	registerUpstreamInteractionRoutes(router, services);
	registerReviewLoginRoutes(router, services);
	return router;
}
