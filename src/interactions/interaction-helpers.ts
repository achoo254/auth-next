import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { InteractionResults } from "oidc-provider";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { MessageParams } from "../i18n/translator.js";
import { CREATE_PROMPT } from "../oidc/interaction-policy.js";
import type { AppServices } from "../services.js";
import { type PageContext, pageContext } from "../ui/page-context.js";
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

/**
 * Page context of an interaction page: the app's `ui_locales` counts, and
 * a page rendered for a POST returns to the interaction itself.
 */
export function interactionPage(
	req: Request,
	interaction: Interaction,
): PageContext {
	return pageContext(req, {
		uiLocales: interaction.params.ui_locales,
		fallbackPath: `/interaction/${interaction.uid}`,
	});
}

export interface InteractionError {
	readonly message: MessageKey;
	readonly params?: MessageParams;
	readonly status?: number;
	readonly back?: { readonly href: string; readonly label: MessageKey };
}

/** An error page in the request's language (default status 400). */
export function sendInteractionError(
	services: AppServices,
	res: Response,
	error: InteractionError,
): void {
	const page = pageContext(res.req);
	sendPage(
		res,
		renderErrorPage({
			host: services.host,
			page,
			message: page.i18n.t(error.message, error.params),
			backHref: error.back?.href,
			backLabel: error.back ? page.i18n.t(error.back.label) : undefined,
		}),
		error.status ?? 400,
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
		sendInteractionError(services, res, {
			message: "error.interactionExpired",
		});
		return undefined;
	}
	if (interaction.uid !== routeParam(req, "uid")) {
		sendInteractionError(services, res, { message: "error.otherInteraction" });
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
	sendInteractionError(services, res, {
		message: "error.formExpired",
		status: 403,
	});
	return false;
}

/**
 * Completes the login prompt for `accountId`, signed in through Google,
 * GitHub or Apple (`amr` "fed") or the review-only sign-in ("pwd",
 * "review"). Every completed sign-in goes through here.
 */
export async function finishLogin(
	services: AppServices,
	req: Request,
	res: Response,
	accountId: string,
	amr: readonly string[],
): Promise<void> {
	// Read again: the account may have been deleted (ADR 0009) since the
	// sign-in was decided; it must not get a new session after that.
	if (!(await services.accounts.findActiveById(accountId))) {
		sendInteractionError(services, res, {
			message: "upstream.rejected.disabled",
			status: 403,
		});
		return;
	}
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
