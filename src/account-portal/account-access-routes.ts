import type { RequestHandler, Router } from "express";
import {
	isUpstreamProvider,
	usableSignInProviders,
} from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import { startUpstream } from "../interactions/upstream-start.js";
import type { AppServices } from "../services.js";
import { forgetDeviceGrants } from "./device-grants.js";
import { revokeGrant } from "./grant-directory.js";
import type { PortalHandler } from "./portal-session.js";
import { revokeSession } from "./session-directory.js";

/**
 * /account actions that grant or take away access: link and unlink
 * Google/GitHub, sign out one session or one Tunelo device. Removing an
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
			// Some other linked provider must still sign in here, or the owner
			// would lock themselves out; the write re-checks it is linked.
			const others = usableSignInProviders(account, [
				...services.upstreams.keys(),
			]).filter((provider) => provider !== name);
			if (others.length === 0) {
				res.redirect(303, "/account?notice=last-method");
				return;
			}
			const write = await services.accounts.links.unlinkProvider(
				account._id,
				name,
			);
			res.redirect(
				303,
				`/account?notice=${write.applied ? "unlinked" : "last-method"}`,
			);
		}),
	);

	router.post(
		"/sessions/:uid/revoke",
		write(async (req, res, { account }) => {
			const done = await revokeSession(
				services.provider,
				services,
				services.logger,
				account._id,
				routeParam(req, "uid"),
			);
			if (done) {
				await services.audit.record(
					"session.revoked",
					account._id,
					{ count: 1, cause: "account-page" },
					auditContext(req),
				);
			}
			res.redirect(
				303,
				`/account?notice=${done ? "session-revoked" : "not-found"}`,
			);
		}),
	);

	router.post(
		"/devices/:grantId/revoke",
		write(async (req, res, { account }) => {
			const grantId = routeParam(req, "grantId");
			const done = await revokeGrant(services.provider, account._id, grantId);
			if (done) {
				await forgetDeviceGrants(services, [grantId]);
				await services.audit.record(
					"grant.revoked",
					account._id,
					{ count: 1, cause: "account-page" },
					auditContext(req),
				);
			}
			res.redirect(
				303,
				`/account?notice=${done ? "device-revoked" : "not-found"}`,
			);
		}),
	);
}
