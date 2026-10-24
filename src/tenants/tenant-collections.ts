import type { Db } from "mongodb";
import { GRANT_META_COLLECTION } from "../account-portal/device-grants.js";
import { SESSION_META_COLLECTION } from "../account-portal/session-directory.js";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { ACCOUNTS_COLLECTION } from "../accounts/user-model.js";
import { AUDIT_OUTBOX_COLLECTION } from "../audit/audit-outbox-model.js";
import { OIDC_MODEL_NAMES, collectionNameFor } from "../oidc/mongo-adapter.js";
import { PUSH_DEVICES_COLLECTION } from "../push/push-devices.js";
import { CLIENT_USAGE_COLLECTION } from "../usage/client-usage-model.js";
import { TENANT_SECRETS_COLLECTION } from "./tenant-secrets.js";

/** Every collection whose documents belong to one tenant (`tenantId`). */
export const TENANT_COLLECTIONS: readonly string[] = [
	ACCOUNTS_COLLECTION,
	ONE_TIME_TOKENS_COLLECTION,
	AUDIT_OUTBOX_COLLECTION,
	SESSION_META_COLLECTION,
	GRANT_META_COLLECTION,
	PUSH_DEVICES_COLLECTION,
	CLIENT_USAGE_COLLECTION,
	...OIDC_MODEL_NAMES.map(collectionNameFor),
];

/**
 * Deletes everything a tenant owned, its sealed secrets included. Only for
 * a tenant that never served anyone (expired before activation).
 */
export async function purgeTenantData(db: Db, tenantId: string): Promise<void> {
	for (const name of [...TENANT_COLLECTIONS, TENANT_SECRETS_COLLECTION]) {
		await db.collection(name).deleteMany({ tenantId });
	}
}

/** Documents of `tenantId` per collection, its sealed secrets included. */
export async function countTenantData(
	db: Db,
	tenantId: string,
): Promise<{ readonly collection: string; readonly count: number }[]> {
	const counts = [];
	for (const name of [...TENANT_COLLECTIONS, TENANT_SECRETS_COLLECTION]) {
		counts.push({
			collection: name,
			count: await db.collection(name).countDocuments({ tenantId }),
		});
	}
	return counts;
}

/**
 * Gives `to` every document of `from` (a tenant moved into an install,
 * whose own tenant is the primary one: ADR 0007 §7). Its secrets are not
 * among them: the install keeps those in its own files.
 */
export async function retagTenantData(
	db: Db,
	from: string,
	to: string,
): Promise<{ readonly collection: string; readonly count: number }[]> {
	const counts = [];
	for (const name of TENANT_COLLECTIONS) {
		const result = await db
			.collection(name)
			.updateMany({ tenantId: from }, { $set: { tenantId: to } });
		counts.push({ collection: name, count: result.modifiedCount });
	}
	return counts;
}

export interface BackfillCount {
	readonly collection: string;
	/** Documents without `tenantId` before this run. */
	readonly untagged: number;
	/** Documents this run tagged (0 on a dry run). */
	readonly tagged: number;
}

/**
 * Tags every document written before tenants existed with `tenantId`
 * (the primary tenant's). Idempotent: a second run finds nothing to tag.
 * A dry run only counts.
 */
export async function backfillTenantId(
	db: Db,
	tenantId: string,
	options: { readonly dryRun: boolean },
): Promise<BackfillCount[]> {
	const counts: BackfillCount[] = [];
	for (const name of TENANT_COLLECTIONS) {
		const collection = db.collection(name);
		// `null` matches a missing field as well as an explicit null.
		const untagged = await collection.countDocuments({ tenantId: null });
		const tagged =
			options.dryRun || untagged === 0
				? 0
				: (
						await collection.updateMany(
							{ tenantId: null },
							{ $set: { tenantId } },
						)
					).modifiedCount;
		counts.push({ collection: name, untagged, tagged });
	}
	return counts;
}
