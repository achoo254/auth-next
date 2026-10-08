import type { Request, Response, Router } from "express";
import { AccountConflictError } from "../accounts/account-conflicts.js";
import { hashSecret } from "../accounts/password-hasher.js";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import { normalizeEmail, normalizeUsername } from "../accounts/user-model.js";
import { formRateLimit, formText, formValue } from "../http/form.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import {
	type Interaction,
	asyncHandler,
	checkCsrf,
	csrfScope,
	loadInteraction,
} from "./interaction-helpers.js";
import { completeLogin } from "./security-review-routes.js";
import { renderRecoveryCodes, renderSignup } from "./signup-page.js";
import {
	PENDING_SIGNUP_SECONDS,
	SIGNUP_TAKEN_MESSAGES,
	validationProblem,
} from "./signup-rules.js";

function showSignup(
	services: AppServices,
	req: Request,
	res: Response,
	interaction: Interaction,
	extra: {
		email?: string;
		username?: string;
		error?: string;
		status?: number;
	} = {},
): void {
	sendPage(
		res,
		renderSignup({
			host: services.host,
			uid: interaction.uid,
			csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
			providers: [...services.upstreams.keys()],
			...extra,
		}),
		extra.status,
	);
}

/**
 * Email/password sign-up. The account starts with an unverified email and
 * eight recovery codes, shown once; the login completes only after the user
 * confirms they saved them.
 */
export function registerSignupRoutes(
	router: Router,
	services: AppServices,
): void {
	router.get(
		"/:uid/signup",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (interaction) showSignup(services, req, res, interaction);
		}),
	);

	router.post(
		"/:uid/signup",
		formRateLimit(20, 60 * 60_000),
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			if (interaction.prompt.name !== "login") {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			const email = normalizeEmail(formText(req, "email", 254));
			const username = normalizeUsername(formText(req, "username", 64));
			const password = formValue(req, "password") ?? "";
			const problem = validationProblem(
				email,
				username,
				password,
				formValue(req, "password_confirm") ?? "",
			);
			if (problem) {
				showSignup(services, req, res, interaction, {
					email,
					username,
					error: problem,
					status: 400,
				});
				return;
			}
			const [passwordHash, recovery] = await Promise.all([
				hashSecret(password),
				generateRecoveryCodes(),
			]);
			let accountId: string;
			try {
				const account = await services.accounts.create({
					username,
					email,
					emailVerifiedBy: null,
					passwordHash,
					recoveryCodeHashes: [...recovery.hashes],
					recoveryCodesCreatedAt: new Date(),
					providers: {},
				});
				accountId = account._id;
			} catch (error) {
				if (!(error instanceof AccountConflictError)) throw error;
				showSignup(services, req, res, interaction, {
					email,
					username,
					error:
						SIGNUP_TAKEN_MESSAGES[error.field] ??
						"Email hoặc username đã được dùng.",
					status: 409,
				});
				return;
			}
			services.logger.info({ accountId }, "Account created");
			// The login completes only once the user confirms the codes are saved.
			await services.accountTokens.issue(
				"signup-pending",
				interaction.uid,
				accountId,
				{},
				PENDING_SIGNUP_SECONDS,
			);
			sendPage(
				res,
				renderRecoveryCodes({
					host: services.host,
					csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
					action: `/interaction/${interaction.uid}/signup/done`,
					username,
					codes: recovery.codes,
					continueLabel: "Tiếp tục",
				}),
			);
		}),
	);

	router.post(
		"/:uid/signup/done",
		asyncHandler(async (req, res) => {
			const interaction = await loadInteraction(services, req, res);
			if (!interaction) return;
			if (!checkCsrf(services, req, res, csrfScope(interaction.uid))) return;
			const pending = await services.accountTokens.peek(
				"signup-pending",
				interaction.uid,
			);
			if (pending.status !== "ok") {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			const { account } = pending;
			if (formValue(req, "saved") !== "yes") {
				sendPage(
					res,
					renderRecoveryCodes({
						host: services.host,
						csrf: services.csrf.token(req, res, csrfScope(interaction.uid)),
						action: `/interaction/${interaction.uid}/signup/done`,
						username: account.username,
						codes: [],
						continueLabel: "Tiếp tục",
						intro:
							"Hãy đánh dấu đã lưu mã khôi phục trước khi tiếp tục. Mã chỉ hiện một lần; nếu chưa kịp lưu, tạo bộ mới ở trang tài khoản.",
					}),
					400,
				);
				return;
			}
			if (
				(await services.accountTokens.take("signup-pending", interaction.uid))
					.status !== "ok"
			) {
				res.redirect(303, `/interaction/${interaction.uid}`);
				return;
			}
			await completeLogin(services, req, res, interaction, account._id, [
				"pwd",
			]);
		}),
	);
}
