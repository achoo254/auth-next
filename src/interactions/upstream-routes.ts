import type { Router } from "express";
import {
	decideUpstreamLogin,
	linkUpstream,
} from "../accounts/account-linking.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { formRateLimit, routeParam } from "../http/form.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { notifyAccount } from "../push/notify-account.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	asyncHandler,
	csrfScope,
	interactionPage,
	loadInteraction,
	sendInteractionError,
} from "./interaction-helpers.js";
import { registerUpstreamFinishRoutes } from "./upstream-finish-routes.js";
import { renderChooseUsername, suggestUsername } from "./upstream-pages.js";
import {
	dropPendingUpstream,
	finishUpstream,
	loadPending,
} from "./upstream-pending.js";
import {
	freshLoginRequired,
	signInProviders,
	startUpstream,
} from "./upstream-start.js";

const REJECTED: ReadonlyMap<string, MessageKey> = new Map([
	["no-verified-email", "upstream.rejected.noVerifiedEmail"],
	["disabled", "upstream.rejected.disabled"],
	["other-provider-account", "upstream.rejected.otherProviderAccount"],
]);

/**
 * Google/GitHub inside an interaction, the only way to sign in or sign up:
 * start, then apply the linking rules to the profile the callback stored.
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
			// A sign-in that must be fresh only goes to a provider that proves it.
			if (!signInProviders(services, interaction).includes(client.provider)) {
				res.sendStatus(404);
				return;
			}
			await startUpstream(services, res, client, "login", {
				uid: interaction.uid,
				freshLogin: freshLoginRequired(interaction),
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
				page: interactionPage(req, interaction),
				uid: interaction.uid,
				csrf,
				provider: profile.provider,
			};
			switch (decision.kind) {
				case "login":
					await finishUpstream(
						services,
						req,
						res,
						interaction,
						decision.account._id,
						profile,
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
					notifyAccount(services, decision.account, {
						kind: "provider-linked",
						provider: profile.provider,
					});
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
						profile,
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
					sendInteractionError(services, res, {
						message: REJECTED.get(decision.reason) ?? "upstream.rejected.other",
						status: 403,
						back: {
							href: `/interaction/${interaction.uid}`,
							label: "username.back",
						},
					});
			}
		}),
	);

	registerUpstreamFinishRoutes(router, services);
}
