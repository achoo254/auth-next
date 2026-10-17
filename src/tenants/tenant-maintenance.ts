import type { Db } from "mongodb";
import { AuditOutbox } from "../audit/audit-outbox.js";
import type { Logger } from "../logger.js";
import { ownerSubject } from "./claim-service.js";
import { checkAllOwnership } from "./ownership-check.js";
import type { OwnershipResolver } from "./ownership-records.js";
import type { RuntimeRegistry } from "./runtime-registry.js";
import type { TenantDocument, TenantRegistry } from "./tenant-registry.js";

/**
 * A claimed tenant not activated within 48 hours expires (frees its slot);
 * so does a self-hosted one whose install never enrolled.
 */
const UNACTIVATED_TTL_MS = 48 * 60 * 60 * 1000;
/** Tick of the job; each tenant's ownership is re-checked every 6 hours. */
const TICK_MS = 60 * 60 * 1000;

export interface TenantMaintenanceDependencies {
	readonly db: Db;
	readonly registry: TenantRegistry;
	readonly runtimes: RuntimeRegistry;
	readonly resolver: OwnershipResolver;
	/** Absent when only self-hosted tenants can exist (SELF_HOSTED_CLAIMS). */
	readonly serviceIp?: string;
	readonly logger: Logger;
}

/**
 * The hourly job of a server with registry tenants: re-checks domain
 * ownership (tenants unchecked for 6 hours), expires claimed tenants never
 * activated within 7 days, drops the runtimes of suspended tenants and
 * records each suspension in the tenant's audit trail.
 */
export function createTenantMaintenance(deps: TenantMaintenanceDependencies): {
	start(): void;
	stop(): void;
} {
	const { db, registry, runtimes, logger } = deps;
	let timer: NodeJS.Timeout | undefined;
	const suspended = async (
		tenant: TenantDocument,
		reason: string,
	): Promise<void> => {
		runtimes.dispose(tenant._id);
		if (!tenant.owner) return;
		await new AuditOutbox(db, { id: tenant._id }, logger).record(
			"tenant.suspended",
			ownerSubject(tenant.owner),
			{ reason },
		);
	};
	const released = async (
		tenant: TenantDocument,
		reason: string,
	): Promise<void> => {
		if (!tenant.owner) return;
		await new AuditOutbox(db, { id: tenant._id }, logger).record(
			"tenant.released",
			ownerSubject(tenant.owner),
			{ reason },
		);
	};
	const tick = async (): Promise<void> => {
		await checkAllOwnership({
			registry,
			resolver: deps.resolver,
			serviceIp: deps.serviceIp,
			logger,
			onSuspended: (tenant) => void suspended(tenant, "ownership"),
			onRestored: (tenant) => runtimes.dispose(tenant._id),
			onReleased: (tenant) => void released(tenant, "ownership"),
		});
		const expired = await registry.expireUnactivated(
			new Date(Date.now() - UNACTIVATED_TTL_MS),
		);
		for (const tenant of expired) await suspended(tenant, "not-activated");
		const unenrolled = await registry.expireEnrolling(
			new Date(Date.now() - UNACTIVATED_TTL_MS),
		);
		for (const tenant of unenrolled) await released(tenant, "not-enrolled");
	};
	const run = (): void => {
		tick().catch((error: unknown) => {
			logger.warn({ err: error }, "Tenant maintenance failed");
		});
	};
	return {
		start() {
			// First pass soon after start, then hourly; each pass only checks
			// tenants not checked for 6 hours, so restarts never skip one.
			setTimeout(run, 60_000).unref();
			timer = setInterval(run, TICK_MS);
			timer.unref();
		},
		stop() {
			clearInterval(timer);
		},
	};
}
