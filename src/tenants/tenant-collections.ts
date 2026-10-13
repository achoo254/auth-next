import type { Db } from "mongodb";
import { GRANT_META_COLLECTION } from "../account-portal/grant-directory.js";
import { SESSION_META_COLLECTION } from "../account-portal/session-directory.js";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { ACCOUNTS_COLLECTION } from "../accounts/user-model.js";
import { AUDIT_OUTBOX_COLLECTION } from "../audit/audit-outbox-model.js";
import { OIDC_MODEL_NAMES, collectionNameFor } from "../oidc/mongo-adapter.js";

/** Every collection whose documents belong to one tenant (`tenantId`). */
export const TENANT_COLLECTIONS: readonly string[] = [
	ACCOUNTS_COLLECTION,
	ONE_TIME_TOKENS_COLLECTION,
	AUDIT_OUTBOX_COLLECTION,
	SESSION_META_COLLECTION,
	GRANT_META_COLLECTION,
	...OIDC_MODEL_NAMES.map(collectionNameFor),
];

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
