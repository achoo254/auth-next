import { type RequestHandler, Router } from "express";
import {
	formRateLimit,
	formText,
	parseForm,
	queryValue,
} from "../http/form.js";
import {
	asyncHandler,
	sendInteractionError,
} from "../interactions/interaction-helpers.js";
import type { AppServices } from "../services.js";
import { sendPage } from "../ui/send-page.js";
import { registerAccessRoutes } from "./account-access-routes.js";
import { renderAccountPage } from "./account-page.js";
import {
	listAuthorizedApps,
	listDeviceGrants,
	listGrants,
} from "./grant-directory.js";
import {
	type PortalHandler,
	consumeReauthState,
	portalCsrfScope,
	portalRoute,
} from "./portal-session.js";
import { listSessions } from "./session-directory.js";

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
				const grants = await listGrants(services.db, account._id);
				const [sessions, devices, apps] = await Promise.all([
					listSessions(services.db, account._id),
					listDeviceGrants(services.db, grants),
					listAuthorizedApps(services.provider, grants),
				]);
				sendPage(
					res,
					renderAccountPage({
						host: services.host,
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
				sendInteractionError(
					services,
					res,
					"Chưa đăng nhập được vào trang tài khoản.",
					400,
					{ href: "/account", label: "Thử lại" },
				);
				return;
			}
			const reauthed = consumeReauthState(
				services,
				req,
				res,
				queryValue(req, "state") ?? "",
			);
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
	return router;
}
