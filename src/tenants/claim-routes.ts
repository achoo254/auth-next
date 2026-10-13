import { Router } from "express";
import {
	portalCsrfScope,
	portalRoute,
} from "../account-portal/portal-session.js";
import type { AccountDocument } from "../accounts/user-model.js";
import {
	UPSTREAM_PROVIDERS,
	isUpstreamProvider,
} from "../accounts/user-model.js";
import {
	formRateLimit,
	formValue,
	parseForm,
	routeParam,
} from "../http/form.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { AppServices } from "../services.js";
import { pageContext } from "../ui/page-context.js";
import { sendPage } from "../ui/send-page.js";
import { issueAdminHandoff } from "./admin-session.js";
import { type ClaimIdentity, renderClaimPage } from "./claim-page.js";
import { type ClaimError, startClaim, verifyClaim } from "./claim-service.js";
import type { Tenancy } from "./tenancy.js";

export const CLAIM_PATH = "/claim";

const ERRORS: Readonly<Record<ClaimError, MessageKey>> = {
	"invalid-domain": "claim.error.invalidDomain",
	taken: "claim.error.taken",
	"too-many-pending": "claim.error.tooManyPending",
	capacity: "claim.error.capacity",
	unavailable: "claim.unavailable",
	"not-found": "claim.error.notFound",
	"dns-txt": "claim.error.dnsTxt",
	"dns-address": "claim.error.dnsAddress",
	"dns-unreachable": "claim.error.dnsUnreachable",
};

const NOTICES: Readonly<Record<string, MessageKey>> = {
	started: "claim.notice.started",
	verified: "claim.notice.verified",
};

/** The identities linked to an account: who could own a claimed domain. */
function identitiesOf(account: AccountDocument): ClaimIdentity[] {
	return UPSTREAM_PROVIDERS.flatMap((provider) => {
		const providerId = account.providers[provider];
		if (!providerId) return [];
		const detail = account.providerDetails?.[provider];
		return [
			{ provider, providerId, label: detail?.login ?? detail?.email ?? "" },
		];
	});
}

function isClaimError(value: unknown): value is ClaimError {
	return typeof value === "string" && value in ERRORS;
}

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
					typeof req.query.notice === "string"
						? NOTICES[req.query.notice]
						: undefined;
				sendPage(
					res,
					renderClaimPage({
						host: services.host,
						page,
						csrf: services.csrf.token(req, res, portalCsrfScope(portal)),
						open: tenancy.serviceIp !== undefined,
						serviceIp: tenancy.serviceIp,
						identities,
						claims: await tenancy.claims.listFor(portal.account._id),
						tenants: await tenancy.registry.listByOwners(identities),
						notice: isClaimError(error)
							? {
									tone: "error",
									text: page.i18n.t(ERRORS[error], {
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
				const result = await verifyClaim(
					tenancy,
					routeParam(req, "claimId"),
					portal.account._id,
				);
				if (result.ok) tenancy.changed(result.value._id);
				res.redirect(
					303,
					`${CLAIM_PATH}?${result.ok ? "notice=verified" : `error=${result.error}`}`,
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
				if (!tenant || !owner || !owns || tenant.status === "suspended") {
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
