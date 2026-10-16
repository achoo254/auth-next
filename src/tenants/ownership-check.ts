import type { Logger } from "../logger.js";
import { type OwnershipResolver, checkOwnership } from "./ownership-records.js";
import type { TenantDocument, TenantRegistry } from "./tenant-registry.js";

/** Failed checks in a row that suspend a tenant (DNS hiccups are forgiven). */
export const SUSPEND_AFTER_FAILURES = 3;

export interface OwnershipCheckDependencies {
	readonly registry: TenantRegistry;
	readonly resolver: OwnershipResolver;
	readonly serviceIp: string;
	readonly logger: Logger;
	/** Called once a tenant is suspended (drops its runtime). */
	readonly onSuspended: (tenant: TenantDocument) => void;
	/** Called once a suspended tenant is restored. */
	readonly onRestored?: (tenant: TenantDocument) => void;
}

/**
 * Re-checks every serving tenant's ownership. A domain that changed hands
 * (TXT gone) or no longer points here fails; after several failures in a
 * row the tenant is suspended: no pages, no tokens, no certificate work.
 */
/** How often each tenant is re-checked. */
export const OWNERSHIP_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Re-checks tenants not checked for OWNERSHIP_CHECK_EVERY_MS. A domain that
 * changed hands (TXT gone) or no longer points here fails; after several
 * definite failures in a row the tenant is suspended: no pages, no tokens,
 * no certificate work. A resolver that cannot answer proves nothing, and a
 * round where every tenant fails looks like a local DNS fault, so nobody
 * is suspended by it.
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
			result: tenant.claimTxt
				? await checkOwnership(
						tenant.domain,
						tenant.claimTxt,
						deps.serviceIp,
						deps.resolver,
					)
				: ("txt" as const),
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
		if (result !== "ok" && failures >= SUSPEND_AFTER_FAILURES) {
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
