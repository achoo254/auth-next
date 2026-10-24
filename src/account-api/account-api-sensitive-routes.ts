import type { RequestHandler, Router } from "express";
import {
	revokeApp,
	signOutSessions,
	unlinkSignInProvider,
} from "../account-portal/account-actions.js";
import { deleteAccount } from "../account-portal/account-deletion.js";
import { sessionUidsOf } from "../account-portal/revoke-access.js";
import {
	isUpstreamProvider,
	normalizeUsername,
	usableSignInProviders,
} from "../accounts/user-model.js";
import { auditContext } from "../audit/audit-context.js";
import { routeParam } from "../http/form.js";
import { issueAppLink } from "../interactions/upstream-app-link.js";
import type { AppServices } from "../services.js";
import { accountLimit } from "./account-api-limits.js";
import {
	type ApiHandler,
	apiContextOf,
	apiRoute,
	sendApiError,
} from "./bearer-auth.js";
import { requireRecentAuth } from "./recent-auth.js";

/**
 * Checks that need no re-authentication and would only waste the caller's
 * fresh ID token (each works once): run before `requireRecentAuth`.
 */
type Precheck = ApiHandler;

/**
 * The web's `sensitive` routes (CSRF + sign-in within 10 minutes), here:
 * bearer + a fresh ID token in the body (`id_token`, recent-auth.ts), on
 * a tighter per-account budget.
 */
export function registerSensitiveRoutes(
	router: Router,
	services: AppServices,
): void {
	const budget = accountLimit(services.accountApiLimits.sensitivePerAccount);
	const reauth = requireRecentAuth(services);
	const sensitive = (
		handler: ApiHandler,
		precheck?: Precheck,
	): RequestHandler[] => [
		budget,
		...(precheck ? [precheckStep(precheck)] : []),
		reauth,
		apiRoute(handler),
	];

	router.post(
		"/apps/:clientId/revoke",
		...sensitive(async (req, res, api) => {
			const { grants } = await revokeApp(
				services,
				api.account,
				routeParam(req, "clientId"),
				{ context: auditContext(req), grantId: api.grantId },
			);
			if (grants === 0) sendApiError(res, 404, "not_found");
			else res.status(204).end();
		}),
	);

	// The app has no browser session of its own, so the web's "every other
	// session" is every browser session here.
	router.post(
		"/sessions/revoke-all",
		...sensitive(async (req, res, api) => {
			const uids = await sessionUidsOf(services, api.account._id);
			await signOutSessions(services, api.account, uids, {
				context: auditContext(req),
				grantId: api.grantId,
			});
			res.status(204).end();
		}),
	);

	router.post(
		"/providers/:provider/unlink",
		...sensitive(
			async (req, res, api) => {
				const provider = routeParam(req, "provider");
				if (!isUpstreamProvider(provider)) {
					sendApiError(res, 404, "not_found");
					return;
				}
				const result = await unlinkSignInProvider(
					services,
					api.account,
					provider,
					{ context: auditContext(req), grantId: api.grantId },
				);
				if (result === "last-method") {
					sendApiError(res, 409, "last_sign_in_method");
				} else res.status(204).end();
			},
			async (req, res, { account }) => {
				const provider = routeParam(req, "provider");
				if (!isUpstreamProvider(provider) || !account.providers[provider]) {
					sendApiError(res, 404, "not_found");
					return;
				}
				const others = usableSignInProviders(account, [
					...services.upstreams.keys(),
				]).filter((name) => name !== provider);
				if (others.length === 0) sendApiError(res, 409, "last_sign_in_method");
			},
		),
	);

	router.post(
		"/providers/:provider/link",
		...sensitive(
			async (req, res, api) => {
				const name = routeParam(req, "provider");
				const client = isUpstreamProvider(name)
					? services.upstreams.get(name)
					: undefined;
				if (!client) {
					sendApiError(res, 409, "provider_unavailable");
					return;
				}
				const url = await issueAppLink(
					services,
					client,
					api.account._id,
					api.grantId,
				);
				if (!url) sendApiError(res, 401, "invalid_token");
				else res.set("cache-control", "no-store").json({ url: url.href });
			},
			async (req, res, { account }) => {
				const name = routeParam(req, "provider");
				if (!isUpstreamProvider(name) || !services.upstreams.has(name)) {
					sendApiError(res, 409, "provider_unavailable");
				} else if (account.providers[name]) {
					sendApiError(res, 409, "already_linked");
				}
			},
		),
	);

	router.delete(
		"/",
		...sensitive(
			async (_req, res, { account }) => {
				// A second call finds the account disabled and ends here too.
				await deleteAccount(services, account._id, "app");
				res.status(204).end();
			},
			async (req, res, { account }) => {
				const body: unknown = req.body;
				const typed =
					typeof body === "object" && body !== null
						? Reflect.get(body, "username")
						: undefined;
				if (
					typeof typed !== "string" ||
					normalizeUsername(typed.slice(0, 100)) !== account.username
				) {
					// As on the web, the username is typed again.
					sendApiError(res, 400, "username_mismatch");
				}
			},
		),
	);
}

/** Runs `precheck`; continues only if it sent no answer. */
function precheckStep(precheck: Precheck): RequestHandler {
	return (req, res, next) => {
		const api = apiContextOf(req);
		if (!api) {
			next(new Error("precheck before requireBearer"));
			return;
		}
		precheck(req, res, api)
			.then(() => {
				if (!res.headersSent) next();
			})
			.catch(next);
	};
}
