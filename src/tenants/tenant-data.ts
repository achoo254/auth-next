import { type Db, MongoServerError } from "mongodb";
import type { Tenant } from "./tenant.js";

/** What a tenant-bound data function needs: the database and whose data. */
export interface TenantDb {
	readonly db: Db;
	readonly tenant: TenantScope;
}

export type TenantScope = Pick<Tenant, "id">;

/** The `tenantId` filter clause: matches only documents of `tenant`. */
export type TenantFilter = { tenantId: string };

/**
 * Filter clause every query on tenant-owned data carries. Every document
 * has a `tenantId` (startup tags pre-tenant ones, tenant-migration.ts), so
 * the match is exact for every tenant, the primary one included.
 */
export function inTenant(tenant: TenantScope): TenantFilter {
	return { tenantId: tenant.id };
}

/** Field stamped on every document a tenant writes. */
export function tenantTag(tenant: TenantScope): { tenantId: string } {
	return { tenantId: tenant.id };
}

function isDuplicateKey(error: unknown): boolean {
	return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Runs an upsert filtered on `_id` and the tenant. MongoDB only retries a
 * racing upsert itself when the filter is exactly the unique key, so when
 * two writers insert the same new id at once one of them gets a duplicate
 * key error; that writer retries as a plain write. If the plain write
 * matches nothing, the id belongs to another tenant and the error stands.
 */
export async function upsertInTenant(
	upsert: () => Promise<unknown>,
	writeExisting: () => Promise<{ readonly matchedCount: number }>,
): Promise<void> {
	try {
		await upsert();
	} catch (error) {
		if (!isDuplicateKey(error)) throw error;
		if ((await writeExisting()).matchedCount === 0) throw error;
	}
}
