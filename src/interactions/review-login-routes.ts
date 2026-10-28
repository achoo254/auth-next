import type { Request, Response, Router } from "express";
import { findOrCreateReviewAccount } from "../accounts/review-account.js";
import { verifyReviewPassword } from "../accounts/review-password-hash.js";
import { normalizeEmail } from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import type { AuditEventData } from "../audit/audit-events.js";
import type { ReviewLoginConfig } from "../config/review-login-env.js";
import { formRateLimit, formText, formValue } from "../http/form.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	type Interaction,
	asyncHandler,
	checkCsrf,
	csrfScope,
	finishLogin,
	interactionPage,
	isSignInPrompt,
	loadInteraction,
} from "./interaction-helpers.js";
import { renderReviewLogin } from "./review-login-page.js";

const MINUTE_MS = 60_000;
/** Failed attempts: 5 per IP in 15 minutes, 30 per hour from everyone. */
const PER_IP = { limit: 5, windowMs: 15 * MINUTE_MS } as const;
const GLOBAL = { limit: 30, windowMs: 60 * MINUTE_MS } as const;
/** `sub` of a failure that names no review account. */
const NO_ACCOUNT_SUB = "review-login";

type FailureReason = AuditEventData["login.failed"]["reason"];

function sendForm(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	failure?: { readonly email: string },
): void {
	sendPage(
		res,
		renderReviewLogin({
			page: interactionPage(req, interaction),
			uid: interaction.uid,
			csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
			email: failure?.email,
			failed: failure !== undefined,
		}),
		failure ? 401 : 200,
	);
}

/** The review account's id, when it exists, for the audit trail. */
async function reviewAccountSub(
	services: AppServices,
	config: ReviewLoginConfig,
): Promise<string> {
	const account = await services.accounts.findByEmail(config.email);
	return account?.reviewLogin === true ? account._id : NO_ACCOUNT_SUB;
}

async function recordFailure(
	services: AppServices,
	req: Request,
	config: ReviewLoginConfig,
	reason: FailureReason,
): Promise<void> {
	services.logger.warn({ reason }, "Review sign-in failed");
	const sub =
		reason === "wrong-password"
			? await reviewAccountSub(services, config)
			: NO_ACCOUNT_SUB;
	await services.audit.record(
		"login.failed",
		sub,
		{ method: "review", reason },
		auditContext(req),
	);
}

/**
 * The review-only password sign-in (ADR 0010) under /interaction/:uid/review.
 * Registered only while it is configured, so otherwise both routes are 404.
 * One allowed email; the answer never says which field was wrong.
 */
export function registerReviewLoginRoutes(
	router: Router,
	services: AppServices,
): void {
	const config = services.reviewLogin;
	if (!config) return;

	router.get(
		"/:uid/review",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!isSignInPrompt(interaction)) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			sendForm(services, req, res, interaction);
		}),
	);

	router.post(
		"/:uid/review",
		formRateLimit(PER_IP.limit, PER_IP.windowMs, { failuresOnly: true }),
		formRateLimit(GLOBAL.limit, GLOBAL.windowMs, {
			failuresOnly: true,
			global: true,
		}),
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			if (!isSignInPrompt(interaction)) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			const email = normalizeEmail(formText(req, "email", 254));
			// Checked whatever the email, so the timing tells nothing either.
			const passwordOk = await verifyReviewPassword(
				config.passwordHash,
				formValue(req, "password") ?? "",
			);
			const reason: FailureReason | undefined =
				email !== config.email
					? "unknown-email"
					: passwordOk
						? undefined
						: "wrong-password";
			if (reason) {
				await recordFailure(services, req, config, reason);
				sendForm(services, req, res, interaction, { email });
				return;
			}
			const result = await findOrCreateReviewAccount(
				services.accounts,
				config.email,
			);
			if (result.kind !== "ok") {
				// A real account holds the email, or the review account is
				// being deleted: a password never opens either.
				services.logger.warn(
					{ reason: result.kind },
					"Review sign-in refused for the configured email",
				);
				sendForm(services, req, res, interaction, { email });
				return;
			}
			await finishLogin(services, req, res, result.account._id, [
				"pwd",
				"review",
			]);
		}),
	);
}
