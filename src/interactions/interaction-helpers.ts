import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InteractionResults } from "oidc-provider";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import { CREATE_PROMPT } from "../oidc/interaction-policy.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import { renderErrorPage } from "./error-page.js";

export type Interaction = Awaited<
	ReturnType<AppServices["provider"]["interactionDetails"]>
>;

/** Runs an async handler and forwards rejections to the error handler. */
export function asyncHandler(
	handler: (req: Request, res: Response) => Promise<void>,
): RequestHandler {
	return (req: Request, res: Response, next: NextFunction) => {
		handler(req, res).catch(next);
	};
}

export function csrfScope(uid: string): string {
	return `interaction:${uid}`;
}

export function sendInteractionError(
	services: AppServices,
	res: Response,
	message: string,
	status = 400,
	back?: { href: string; label: string },
): void {
	sendPage(
		res,
		renderErrorPage({
			host: services.host,
			message,
			backHref: back?.href,
			backLabel: back?.label,
		}),
		status,
	);
}

/**
 * The interaction this browser is in, read through the interaction cookie
 * (so nobody can act on another browser's interaction by knowing its uid).
 * Renders an error page and returns undefined when it is gone or the URL
 * names a different one.
 */
export async function loadInteraction(
	services: AppServices,
	req: Request,
	res: Response,
): Promise<Interaction | undefined> {
	let interaction: Interaction;
	try {
		interaction = await services.provider.interactionDetails(req, res);
	} catch {
		sendInteractionError(
			services,
			res,
			"Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Quay lại ứng dụng và đăng nhập lại.",
		);
		return undefined;
	}
	if (interaction.uid !== routeParam(req, "uid")) {
		sendInteractionError(
			services,
			res,
			"Trang này thuộc về một phiên đăng nhập khác. Quay lại ứng dụng và đăng nhập lại.",
		);
		return undefined;
	}
	return interaction;
}

/** Checks the form's CSRF token; renders 403 and returns false on failure. */
export function checkCsrf(
	services: AppServices,
	req: Request,
	res: Response,
	scope: string,
): boolean {
	if (services.csrf.verify(req, scope)) return true;
	sendInteractionError(
		services,
		res,
		"Biểu mẫu đã hết hạn. Tải lại trang rồi thử lại.",
		403,
	);
	return false;
}

/**
 * Completes the login prompt for `accountId`, signed in through Google or
 * GitHub (`amr` "fed"). Every completed sign-in goes through here.
 */
export async function finishLogin(
	services: AppServices,
	req: Request,
	res: Response,
	accountId: string,
	amr: readonly string[],
): Promise<void> {
	const result: InteractionResults = {
		login: { accountId, amr: [...amr] },
	};
	await services.provider.interactionFinished(req, res, result, {
		mergeWithLastSubmission: false,
	});
	await services.audit.record(
		"login.succeeded",
		accountId,
		{ methods: [...amr] },
		auditContext(req),
	);
}

/**
 * True while the interaction waits for a sign-in: the login prompt, or
 * `prompt=create` (sign-up first, sign-in still possible).
 */
export function isSignInPrompt(interaction: Interaction): boolean {
	return (
		interaction.prompt.name === "login" ||
		interaction.prompt.name === CREATE_PROMPT
	);
}

/** The client id an interaction is for. */
export function interactionClientId(interaction: Interaction): string {
	const clientId: unknown = interaction.params.client_id;
	return typeof clientId === "string" ? clientId : "";
}
