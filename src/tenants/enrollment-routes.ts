import express, { Router } from "express";
import { portalRoute } from "../account-portal/portal-session.js";
import { formRateLimit, parseForm, routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { ownedTenant } from "./claim-route-state.js";
import { CLAIM_PATH } from "./claim-routes.js";
import { issueEnrollmentBundle } from "./enrollment-bundle.js";
import { type RedeemError, redeemEnrollment } from "./enrollment-redeem.js";
import type { Tenancy } from "./tenancy.js";

/** Where a self-hosted install redeems its bundle (server to server, JSON). */
export const ENROLLMENT_REDEEM_PATH = `${CLAIM_PATH}/enrollments`;

/** Bundle, key and a little JSON around them. */
const MAX_REDEEM_BODY = "16kb";

const REDEEM_STATUS: Readonly<Record<RedeemError, number>> = {
	"invalid-bundle": 400,
	"invalid-key": 400,
	"not-enrolling": 409,
	"dns-txt": 403,
	challenge: 403,
	"dns-unreachable": 503,
};

function field(body: unknown, name: string): unknown {
	return typeof body === "object" && body !== null
		? Reflect.get(body, name)
		: undefined;
}

/**
 * The gateway side of ADR 0007 on the primary tenant: the owner of an
 * `enrolling` tenant downloads its bundle from /claim (CSRF, recent
 * sign-in), and the tenant's install redeems it here. Redemption carries
 * no cookie and no session: the bundle and the challenge are its proof.
 */
export function createEnrollmentRouter(
	services: AppServices,
	tenancy: Tenancy,
): Router {
	const router = Router();
	const limit = formRateLimit(services.formPostsPerMinute);

	router.post(
		`${CLAIM_PATH}/tenants/:tenantId/enrollment`,
		limit,
		parseForm,
		portalRoute(
			services,
			async (req, res, portal) => {
				const owned = await ownedTenant(
					tenancy,
					portal.account,
					routeParam(req, "tenantId"),
				);
				if (!owned || owned.tenant.status !== "enrolling") {
					res.redirect(303, `${CLAIM_PATH}?error=not-found`);
					return;
				}
				const bundle = await issueEnrollmentBundle({
					issuer: tenancy.issuer,
					jwks: tenancy.signingJwks,
					tenant: owned.tenant,
					owner: owned.owner,
				});
				res
					.status(200)
					.set("cache-control", "no-store")
					.attachment(`enrollment-${owned.tenant.domain}.jwt`)
					.type("application/jwt")
					.send(bundle);
			},
			{ csrf: true, recentLogin: true },
		),
	);

	router.post(
		ENROLLMENT_REDEEM_PATH,
		limit,
		express.json({ limit: MAX_REDEEM_BODY, type: "application/json" }),
		(req, res, next) => {
			redeemEnrollment(tenancy, {
				bundle: field(req.body, "bundle"),
				installKey: field(req.body, "install_key"),
			})
				.then((result) => {
					res.set("cache-control", "no-store");
					if (result.ok) {
						// The pull token is shown once: only its hash is kept.
						res.status(200).json({
							status: "self_hosted",
							tenant_id: result.tenantId,
							pull_token: result.pullToken,
						});
						return;
					}
					res.status(REDEEM_STATUS[result.error]).json({ error: result.error });
				})
				.catch(next);
		},
	);
	return router;
}
