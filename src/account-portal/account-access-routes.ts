import type { RequestHandler, Router } from "express";
import { isUpstreamProvider } from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import { startUpstream } from "../interactions/upstream-start.js";
import type { AppServices } from "../services.js";
import {
	revokeDevice,
	signOutSessions,
	unlinkSignInProvider,
} from "./account-actions.js";
import type { PortalHandler } from "./portal-session.js";

/**
 * /account actions that grant or take away access: link and unlink
 * Google/GitHub/Apple, sign out one session or one Tunelo device. Removing an
 * app's access asks first (account-confirm-routes.ts).
 */
export function registerAccessRoutes(
	router: Router,
	services: AppServices,
	write: (handler: PortalHandler) => RequestHandler,
	sensitive: (handler: PortalHandler) => RequestHandler,
): void {
	router.post(
		"/link/:provider",
		sensitive(async (req, res, { account }) => {
			const name = routeParam(req, "provider");
			const client = isUpstreamProvider(name)
				? services.upstreams.get(name)
				: undefined;
			if (!client) {
				res.sendStatus(404);
				return;
			}
			await startUpstream(services, res, client, "link", {
				accountId: account._id,
			});
		}),
	);

	router.post(
		"/unlink/:provider",
		sensitive(async (req, res, { account }) => {
			const name = routeParam(req, "provider");
			if (!isUpstreamProvider(name)) {
				res.sendStatus(404);
				return;
			}
			const result = await unlinkSignInProvider(services, account, name, {
				context: auditContext(req),
			});
			res.redirect(
				303,
				`/account?notice=${result === "unlinked" ? "unlinked" : "last-method"}`,
			);
		}),
	);

	router.post(
		"/sessions/:uid/revoke",
		write(async (req, res, { account }) => {
			const done = await signOutSessions(
				services,
				account,
				[routeParam(req, "uid")],
				{ context: auditContext(req) },
			);
			res.redirect(
				303,
				`/account?notice=${done > 0 ? "session-revoked" : "not-found"}`,
			);
		}),
	);

	router.post(
		"/devices/:grantId/revoke",
		write(async (req, res, { account }) => {
			const done = await revokeDevice(
				services,
				account,
				routeParam(req, "grantId"),
				{ context: auditContext(req) },
			);
			res.redirect(
				303,
				`/account?notice=${done ? "device-revoked" : "not-found"}`,
			);
		}),
	);
}
