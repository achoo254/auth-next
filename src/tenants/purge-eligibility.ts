import type { TenantStatus } from "./tenant.js";

/** The backups' window: a self-hosted tenant's data stays this long. */
export const PURGE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface PurgeCandidate {
	readonly status: TenantStatus;
	readonly enrolledAt?: Date;
}

/**
 * Why `purge-tenant` must not delete this tenant's data, or `undefined`
 * when it may. Normally only a tenant self-hosted for the retention window
 * qualifies (ADR 0007 §7). `anyStatus` lifts that rule, for the owner
 * shutting tenants down entirely: the caller backs the databases up first.
 */
export function purgeRefusal(
	domain: string,
	tenant: PurgeCandidate | undefined,
	now: number,
	anyStatus: boolean,
): string | undefined {
	if (!tenant) return `${domain} is not a tenant`;
	if (anyStatus) return undefined;
	if (tenant.status !== "self_hosted" || !tenant.enrolledAt) {
		return `${domain} is not a tenant that moved to its own servers`;
	}
	const since = now - tenant.enrolledAt.getTime();
	if (since < PURGE_RETENTION_MS) {
		const days = Math.ceil(
			(PURGE_RETENTION_MS - since) / (24 * 60 * 60 * 1000),
		);
		return `${domain} moved less than 14 days ago; ${days} day(s) left`;
	}
	return undefined;
}
