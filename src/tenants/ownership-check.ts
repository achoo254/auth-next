import type { Logger } from "../logger.js";
import {
	type OwnershipResolver,
	type OwnershipResult,
	checkClaimTxt,
	checkOwnership,
} from "./ownership-records.js";
import {
	type TenantDocument,
	type TenantRegistry,
	isSelfHosted,
} from "./tenant-registry.js";

/** Failed checks in a row that suspend a tenant (DNS hiccups are forgiven). */
export const SUSPEND_AFTER_FAILURES = 3;

export interface OwnershipCheckDependencies {
	readonly registry: TenantRegistry;
	readonly resolver: OwnershipResolver;
	/** Absent: tenants hosted here cannot be checked (nothing to point at). */
	readonly serviceIp?: string;
	readonly logger: Logger;
	/** Called once a tenant is suspended (drops its runtime). */
	readonly onSuspended: (tenant: TenantDocument) => void;
	/** Called once a self-hosted tenant lost its TXT and was removed. */
	readonly onReleased?: (tenant: TenantDocument) => void;
	/** Called once a suspended tenant is restored. */
	readonly onRestored?: (tenant: TenantDocument) => void;
}

/** How often each tenant is re-checked. */
export const OWNERSHIP_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * One tenant's check: the TXT only for a self-hosted tenant (its hosts run
 * elsewhere), else the TXT and every host pointing here.
 */
async function checkTenant(
	tenant: TenantDocument,
	deps: OwnershipCheckDependencies,
): Promise<OwnershipResult> {
	if (!tenant.claimTxt) return "txt";
	if (isSelfHosted(tenant) || tenant.status === "migrating") {
		return checkClaimTxt(tenant.domain, tenant.claimTxt, deps.resolver);
	}
	if (!deps.serviceIp) return "unknown";
	return checkOwnership(
		tenant.domain,
		tenant.claimTxt,
		deps.serviceIp,
		deps.resolver,
	);
}

/**
 * Re-checks tenants not checked for OWNERSHIP_CHECK_EVERY_MS. A domain that
 * changed hands (TXT gone) or no longer points here fails; after several
 * definite failures in a row the tenant is suspended: no pages, no tokens,
 * no certificate work. A self-hosted tenant has nothing here to suspend:
 * its record is removed instead, and the domain can be claimed again. A
 * resolver that cannot answer proves nothing, and a round where every
 * tenant fails looks like a local DNS fault, so nobody is suspended by it.
 */
export async function checkAllOwnership(
	deps: OwnershipCheckDependencies,
): Promise<{ checked: number; suspended: number }> {
	const due = await deps.registry.listDueForOwnershipCheck(
		new Date(Date.now() - OWNERSHIP_CHECK_EVERY_MS),
	);
	const results = await Promise.all(
		due.map(async (tenant) => ({
			tenant,
			result: await checkTenant(tenant, deps),
		})),
	);
	const failed = results.filter(
		({ result }) => result === "txt" || result === "address",
	);
	if (results.length > 1 && failed.length === results.length) {
		deps.logger.warn(
			{ checked: results.length },
			"Every tenant failed its ownership check; suspecting local DNS, nobody suspended",
		);
		return { checked: 0, suspended: 0 };
	}
	let suspended = 0;
	for (const { tenant, result } of results) {
		if (result === "unknown") continue;
		if (tenant.status === "suspended") {
			// Suspended for ownership: back as soon as the domain checks out.
			if (result === "ok" && (await deps.registry.restoreOwnership(tenant))) {
				deps.onRestored?.(tenant);
				deps.logger.info(
					{ tenantId: tenant._id },
					"Tenant restored: domain ownership holds again",
				);
			} else {
				await deps.registry.recordOwnershipCheck(tenant._id, false);
			}
			continue;
		}
		const failures = await deps.registry.recordOwnershipCheck(
			tenant._id,
			result === "ok",
		);
		// A moving tenant waits for its install whatever DNS says meanwhile.
		if (tenant.status === "migrating") continue;
		if (result !== "ok" && failures >= SUSPEND_AFTER_FAILURES) {
			if (isSelfHosted(tenant)) {
				if (await deps.registry.removeSelfHosted(tenant._id)) {
					deps.onReleased?.(tenant);
					deps.logger.warn(
						{ tenantId: tenant._id, domain: tenant.domain, failures },
						"Self-hosted tenant removed: its claim TXT record is gone",
					);
				}
				continue;
			}
			await deps.registry.update(tenant._id, {
				status: "suspended",
				suspendedAt: new Date(),
				suspendedReason: "ownership",
			});
			deps.onSuspended(tenant);
			deps.logger.warn(
				{ tenantId: tenant._id, domain: tenant.domain, failures },
				"Tenant suspended: domain ownership no longer holds",
			);
			suspended += 1;
		}
	}
	return { checked: results.length, suspended };
}
