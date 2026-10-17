import { Router } from "express";
import { portalRoute } from "../account-portal/portal-session.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { formRateLimit, parseForm, routeParam } from "../http/form.js";
import type { AppServices } from "../services.js";
import { ownedTenant } from "./claim-route-state.js";
import { CLAIM_PATH } from "./claim-routes.js";
import { ownerSubject } from "./claim-service.js";
import type { Tenancy } from "./tenancy.js";

/**
 * Moving an active tenant to its owner's servers (ADR 0007 §7), from
 * /claim: the owner starts the move, which stops serving the domain here
 * at once, then downloads the bundle like a self-hosted claim; until the
 * install enrolls, the owner can cancel and the domain is served again.
 * Offered only with SELF_HOSTED_CLAIMS. CSRF and a recent sign-in, like
 * opening /admin.
 */
export function createMigrationRouter(
	services: AppServices,
	tenancy: Tenancy,
): Router {
	const router = Router();
	const limit = formRateLimit(services.formPostsPerMinute);

	for (const [action, move, event, notice] of [
		["migration", "startMigration", "tenant.migrating", "migrating"],
		[
			"migration/cancel",
			"cancelMigration",
			"tenant.migration_cancelled",
			"migration-cancelled",
		],
	] as const) {
		router.post(
			`${CLAIM_PATH}/tenants/:tenantId/${action}`,
			limit,
			parseForm,
			portalRoute(
				services,
				async (req, res, portal) => {
					const owned = tenancy.selfHostedClaims
						? await ownedTenant(
								tenancy,
								portal.account,
								routeParam(req, "tenantId"),
							)
						: undefined;
					if (!owned || !(await tenancy.registry[move](owned.tenant._id))) {
						res.redirect(303, `${CLAIM_PATH}?error=not-found`);
						return;
					}
					// Its runtime goes (or comes back) with the new status.
					tenancy.changed(owned.tenant._id);
					await new AuditOutbox(
						tenancy.db,
						{ id: owned.tenant._id },
						tenancy.logger,
					).record(event, ownerSubject(owned.owner), {
						domain: owned.tenant.domain,
					});
					res.redirect(303, `${CLAIM_PATH}?notice=${notice}`);
				},
				{ csrf: true, recentLogin: true },
			),
		);
	}
	return router;
}
