import { type RequestHandler, Router } from "express";
import type { AccountDocument } from "../accounts/user-model.js";
import {
	formRateLimit,
	formText,
	parseForm,
	queryValue,
} from "../http/form.js";
import type { Locale } from "../i18n/locales.js";
import {
	asyncHandler,
	sendInteractionError,
} from "../interactions/interaction-helpers.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { registerAccessRoutes } from "./account-access-routes.js";
import { registerConfirmRoutes } from "./account-confirm-routes.js";
import { renderAccountPage } from "./account-page.js";
import { listDeviceGrants } from "./device-grants.js";
import { listAuthorizedApps, listGrants } from "./grant-directory.js";
import {
	type PortalHandler,
	consumePortalReturn,
	consumeReauthState,
	portalCsrfScope,
	portalRoute,
} from "./portal-session.js";
import { listSessions } from "./session-directory.js";

/**
 * The bot follows the language the owner reads /account in. Skipped when
 * nothing would change; a failed write only costs the bot's language, so it
 * is logged and the page still renders.
 */
async function rememberTelegramLocale(
	services: AppServices,
	account: AccountDocument,
	locale: Locale,
): Promise<void> {
	if (!account.telegram || account.telegramLocale === locale) return;
	try {
		await services.accounts.updateTelegramLocale(account._id, locale);
	} catch (error) {
		services.logger.warn(
			{ err: error, accountId: account._id },
			"Telegram language not saved",
		);
	}
}

/** /account: the signed-in user's own account page and its actions. */
export function createAccountRouter(services: AppServices): Router {
	const router = Router();
	const write = (handler: PortalHandler): RequestHandler =>
		portalRoute(services, handler, { csrf: true });
	const sensitive = (handler: PortalHandler): RequestHandler =>
		portalRoute(services, handler, { csrf: true, recentLogin: true });
	router.post("/*splat", formRateLimit(services.formPostsPerMinute), parseForm);

	router.get(
		"/",
		portalRoute(
			services,
			async (req, res, portal) => {
				const { account } = portal;
				const page = pageContext(req);
				const grants = await listGrants(services, account._id);
				const [sessions, devices, apps] = await Promise.all([
					listSessions(services, account._id),
					listDeviceGrants(services, services.provider, grants),
					listAuthorizedApps(services.provider, grants),
					rememberTelegramLocale(services, account, page.i18n.locale),
				]);
				sendPage(
					res,
					renderAccountPage({
						host: services.host,
						page,
						csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
						account,
						currentSessionUid: portal.sessionUid,
						providers: [...services.upstreams.keys()],
						telegramEnabled: services.telegram !== undefined,
						sessions,
						devices,
						apps,
						notice: queryValue(req, "notice"),
					}),
				);
			},
			{ csrf: false },
		),
	);

	// The portal client's redirect URI: the session cookie is set by now.
	router.get(
		"/callback",
		asyncHandler(async (req, res) => {
			if (queryValue(req, "error")) {
				sendInteractionError(services, res, {
					message: "account.callbackFailed",
					back: { href: "/account", label: "common.tryAgain" },
				});
				return;
			}
			const reauthed = consumeReauthState(
				services,
				req,
				res,
				queryValue(req, "state") ?? "",
			);
			const returnTo = consumePortalReturn(services, req, res);
			if (returnTo) {
				res.redirect(303, returnTo);
				return;
			}
			res.redirect(303, reauthed ? "/account?notice=reauthed" : "/account");
		}),
	);

	router.post(
		"/profile",
		write(async (req, res, { account }) => {
			const name = formText(req, "name", 100);
			await services.accounts.updateName(account._id, name || undefined);
			res.redirect(303, "/account?notice=profile");
		}),
	);

	registerAccessRoutes(router, services, write, sensitive);
	const page = (handler: PortalHandler): RequestHandler =>
		portalRoute(services, handler, { csrf: false });
	registerConfirmRoutes(router, services, page, sensitive);
	return router;
}
