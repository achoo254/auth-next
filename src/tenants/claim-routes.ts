import { Router } from "express";
import {
	portalCsrfScope,
	portalRoute,
} from "../account-portal/portal-session.js";
import { isUpstreamProvider } from "../accounts/user-model.js";
import {
	formRateLimit,
	formValue,
	parseForm,
	routeParam,
} from "../http/form.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { issueAdminHandoff } from "./admin-session.js";
import { verifyFailureQuery, wrongRecordsFrom } from "./claim-dns-feedback.js";
import { renderClaimPage } from "./claim-page.js";
import {
	CLAIM_ERRORS,
	CLAIM_NOTICES,
	identitiesOf,
	isClaimError,
	offeredHostings,
	verifiedNotice,
} from "./claim-route-state.js";
import { startClaim, verifyClaim } from "./claim-service.js";
import type { Tenancy } from "./tenancy.js";
import { isSelfHosted } from "./tenant-registry.js";

export const CLAIM_PATH = "/claim";

/**
 * /claim on the primary tenant: a signed-in account starts a claim for an
 * identity linked to it, checks the DNS, and opens the claimed tenant's
 * /admin through a one-time link. Every POST needs the portal's CSRF token;
 * opening /admin also needs a recent sign-in.
 */
export function createClaimRouter(
	services: AppServices,
	tenancy: Tenancy,
): Router {
	const router = Router();
	const limit = formRateLimit(services.formPostsPerMinute);

	router.get(
		CLAIM_PATH,
		portalRoute(
			services,
			async (req, res, portal) => {
				const page = pageContext(req, { fallbackPath: CLAIM_PATH });
				const identities = identitiesOf(portal.account);
				const error = req.query.error;
				const notice =
					typeof req.query.notice === "string" &&
					Object.hasOwn(CLAIM_NOTICES, req.query.notice)
						? CLAIM_NOTICES[req.query.notice]
						: undefined;
				sendPage(
					res,
					renderClaimPage({
						host: services.host,
						page,
						csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
						hostings: offeredHostings(tenancy),
						serviceIp: tenancy.serviceIp,
						identities,
						claims: await tenancy.claims.listFor(portal.account._id),
						tenants: await tenancy.registry.listByOwners(identities),
						wrongRecords: wrongRecordsFrom(req.query),
						notice: isClaimError(error)
							? {
									tone: "error",
									text: page.i18n.t(CLAIM_ERRORS[error], {
										ip: tenancy.serviceIp ?? "",
									}),
								}
							: notice
								? { tone: "success", text: page.i18n.t(notice) }
								: undefined,
					}),
				);
			},
			{ csrf: false },
		),
	);

	router.post(
		CLAIM_PATH,
		limit,
		parseForm,
		portalRoute(
			services,
			async (req, res, portal) => {
				const provider = formValue(req, "owner");
				const owner = identitiesOf(portal.account).find(
					(identity) => identity.provider === provider,
				);
				if (!isUpstreamProvider(provider) || !owner) {
					res.redirect(303, `${CLAIM_PATH}?error=invalid-domain`);
					return;
				}
				const result = await startClaim(tenancy, {
					domain: formValue(req, "domain") ?? "",
					owner: { provider: owner.provider, providerId: owner.providerId },
					accountId: portal.account._id,
					identities: identitiesOf(portal.account),
					hosting: formValue(req, "hosting") === "self" ? "self" : "hoandat",
				});
				res.redirect(
					303,
					`${CLAIM_PATH}?${result.ok ? "notice=started" : `error=${result.error}`}`,
				);
			},
			{ csrf: true },
		),
	);

	router.post(
		`${CLAIM_PATH}/:claimId/verify`,
		limit,
		parseForm,
		portalRoute(
			services,
			async (req, res, portal) => {
				const claimId = routeParam(req, "claimId");
				const result = await verifyClaim(tenancy, claimId, {
					id: portal.account._id,
					identities: identitiesOf(portal.account),
				});
				if (result.ok) tenancy.changed(result.value._id);
				res.redirect(
					303,
					`${CLAIM_PATH}?${result.ok ? verifiedNotice(result.value) : verifyFailureQuery(result.error, claimId, result.wrongHosts)}`,
				);
			},
			{ csrf: true },
		),
	);

	router.post(
		`${CLAIM_PATH}/tenants/:tenantId/admin`,
		limit,
		parseForm,
		portalRoute(
			services,
			async (req, res, portal) => {
				const tenant = await tenancy.registry.findById(
					routeParam(req, "tenantId"),
				);
				const owner = tenant?.owner;
				const owns =
					owner !== undefined &&
					identitiesOf(portal.account).some(
						(identity) =>
							identity.provider === owner.provider &&
							identity.providerId === owner.providerId,
					);
				// A self-hosted tenant has its /admin on its own servers.
				if (
					!tenant ||
					!owner ||
					!owns ||
					tenant.status === "suspended" ||
					isSelfHosted(tenant)
				) {
					res.redirect(303, `${CLAIM_PATH}?error=not-found`);
					return;
				}
				res.redirect(303, await issueAdminHandoff(tenancy, tenant, owner));
			},
			{ csrf: true, recentLogin: true },
		),
	);
	return router;
}
