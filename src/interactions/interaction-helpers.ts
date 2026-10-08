import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InteractionResults } from "oidc-provider";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
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

/** Completes the login prompt for `accountId` and remembers this browser. */
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
	// From now on this browser has its own budget instead of the account's.
	// Read fresh: the cookie is signed with the current credential generation.
	const account = await services.accounts.findActiveById(accountId);
	if (account) services.devices.remember(req, res, account);
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

/** The client id an interaction is for. */
export function interactionClientId(interaction: Interaction): string {
	const clientId: unknown = interaction.params.client_id;
	return typeof clientId === "string" ? clientId : "";
}
