import type { Request, RequestHandler, Response, Router } from "express";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { revokeApp, signOutSessions } from "./account-actions.js";
import {
	renderRemoveAppConfirm,
	renderRevokeOthersConfirm,
} from "./account-confirm-page.js";
import { appRevokePath } from "./account-connection-cards.js";
import { REVOKE_OTHER_SESSIONS_PATH } from "./account-sections.js";
import { listAuthorizedApps, listGrants } from "./grant-directory.js";
import {
	type PortalContext,
	type PortalHandler,
	portalCsrfScope,
} from "./portal-session.js";
import { otherSessionUids } from "./revoke-access.js";
import { listSessions } from "./session-directory.js";

type Wrap = (handler: PortalHandler) => RequestHandler;

/** Path of a confirmation route inside the /account router. */
function routerPath(path: string): string {
	return path.replace(/^\/account/, "");
}

/**
 * /account actions that ask first on their own page: removing an app's
 * access, signing out every other session. GET shows the page (signed-in
 * only); POST acts and needs the CSRF token and a recent sign-in.
 */
export function registerConfirmRoutes(
	router: Router,
	services: AppServices,
	page: Wrap,
	sensitive: Wrap,
): void {
	const csrfFor = (req: Request, res: Response, portal: PortalContext) =>
		services.csrf.token(req, res, portalCsrfScope(portal));

	router.get(
		"/apps/:clientId/revoke",
		page(async (req, res, portal) => {
			const clientId = routeParam(req, "clientId");
			const grants = (await listGrants(services, portal.account._id)).filter(
				(grant) => grant.clientId === clientId,
			);
			const [app] = await listAuthorizedApps(services.provider, grants);
			if (!app) {
				res.redirect(303, "/account?notice=not-found");
				return;
			}
			sendPage(
				res,
				renderRemoveAppConfirm({
					page: pageContext(req),
					csrf: csrfFor(req, res, portal),
					action: appRevokePath(clientId),
					app,
				}),
			);
		}),
	);

	router.post(
		"/apps/:clientId/revoke",
		sensitive(async (req, res, { account }) => {
			const { grants } = await revokeApp(
				services,
				account,
				routeParam(req, "clientId"),
				{ context: auditContext(req) },
			);
			res.redirect(
				303,
				`/account?notice=${grants > 0 ? "app-revoked" : "not-found"}`,
			);
		}),
	);

	const othersPath = routerPath(REVOKE_OTHER_SESSIONS_PATH);
	router.get(
		othersPath,
		page(async (req, res, portal) => {
			const others = (await listSessions(services, portal.account._id)).filter(
				(session) => session.uid !== portal.sessionUid,
			);
			if (others.length === 0) {
				res.redirect(303, "/account?notice=not-found");
				return;
			}
			sendPage(
				res,
				renderRevokeOthersConfirm({
					page: pageContext(req),
					csrf: csrfFor(req, res, portal),
					action: REVOKE_OTHER_SESSIONS_PATH,
					others,
				}),
			);
		}),
	);

	router.post(
		othersPath,
		sensitive(async (req, res, { account, sessionUid }) => {
			const uids = await otherSessionUids(services, account._id, sessionUid);
			// The same sign-out as one session's button, for each of them.
			const count = await signOutSessions(services, account, uids, {
				context: auditContext(req),
			});
			res.redirect(
				303,
				`/account?notice=${count > 0 ? "sessions-revoked" : "not-found"}`,
			);
		}),
	);
}
