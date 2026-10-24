import express, { Router } from "express";
import { z } from "zod";
import {
	revokeDevice,
	signOutSessions,
	updateProfileName,
} from "../account-portal/account-actions.js";
import { listDeviceGrants } from "../account-portal/device-grants.js";
import {
	listAuthorizedApps,
	listGrants,
} from "../account-portal/grant-directory.js";
import { listSessions } from "../account-portal/session-directory.js";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { accountLimit, ipLimit } from "./account-api-limits.js";
import { registerSensitiveRoutes } from "./account-api-sensitive-routes.js";
import { accountView } from "./account-api-view.js";
import { registerAppLinkRoutes } from "./app-link-routes.js";
import { apiRoute, requireBearer, sendApiError } from "./bearer-auth.js";
import { registerPushDeviceRoutes } from "./push-device-routes.js";

/** Where the router is mounted (primary tenant only, app.ts). */
export const ACCOUNT_API_PATH = "/api/account";

const profileBody = z.object({
	name: z.string().trim().max(100).nullable(),
});

/**
 * /api/account: what /account does, as JSON for the iOS account app,
 * behind its bearer token. Guards mirror the web: a web `write` is a valid
 * token here, a web `sensitive` also needs a fresh ID token
 * (account-api-sensitive-routes.ts). The JSON body parser lives in this
 * router only, never in front of oidc-provider.
 */
export function createAccountApiRouter(services: AppServices): Router {
	const router = Router();
	const limits = services.accountApiLimits;
	router.use(ipLimit(limits));
	router.use(express.json({ limit: "16kb" }));
	router.use(requireBearer(services));
	router.use(accountLimit(limits.perAccount));

	router.get(
		"/",
		apiRoute(async (_req, res, api) => {
			const { account } = api;
			const grants = await listGrants(services, account._id);
			const [sessions, devices, apps] = await Promise.all([
				listSessions(services, account._id),
				listDeviceGrants(services, services.provider, grants),
				listAuthorizedApps(services.provider, grants),
			]);
			res.set("cache-control", "no-store").json(
				accountView({
					account,
					enabledProviders: [...services.upstreams.keys()],
					telegramAvailable: services.telegram !== undefined,
					sessions,
					devices,
					apps,
					currentGrantId: api.grantId,
				}),
			);
		}),
	);

	router.patch(
		"/profile",
		apiRoute(async (req, res, { account }) => {
			const body = profileBody.safeParse(req.body);
			if (!body.success) {
				sendApiError(res, 400, "invalid_name", "name: at most 100 characters");
				return;
			}
			await updateProfileName(services, account, body.data.name ?? undefined);
			res.status(204).end();
		}),
	);

	router.post(
		"/sessions/:uid/revoke",
		apiRoute(async (req, res, { account, grantId }) => {
			const count = await signOutSessions(
				services,
				account,
				[routeParam(req, "uid")],
				{ context: auditContext(req), grantId },
			);
			if (count === 0) sendApiError(res, 404, "not_found");
			else res.status(204).end();
		}),
	);

	router.post(
		"/devices/:grantId/revoke",
		apiRoute(async (req, res, api) => {
			const done = await revokeDevice(
				services,
				api.account,
				routeParam(req, "grantId"),
				{ context: auditContext(req), grantId: api.grantId },
			);
			if (!done) sendApiError(res, 404, "not_found");
			else res.status(204).end();
		}),
	);

	registerSensitiveRoutes(router, services);
	registerAppLinkRoutes(router, services);
	registerPushDeviceRoutes(router, services);
	router.use((_req, res) => {
		sendApiError(res, 404, "not_found");
	});
	return router;
}
