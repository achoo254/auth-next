import type { Db } from "mongodb";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { ACCOUNTS_COLLECTION } from "../accounts/user-model.js";
import { AUDIT_OUTBOX_COLLECTION } from "../audit/audit-outbox-model.js";
import type { Logger } from "../logger.js";
import { GRANTABLE_MODELS, collectionNameFor } from "../oidc/mongo-adapter.js";
import { PRIMARY_TENANT_ID } from "./env-tenant.js";
import { backfillTenantId } from "./tenant-collections.js";

/**
 * Indexes of the single-tenant era. The five unique ones on `accounts`
 * would refuse the same username, email or provider account in a second
 * tenant; the others are replaced by indexes that lead with `tenantId`.
 */
const LEGACY_INDEXES = new Map<string, readonly string[]>([
	[
		ACCOUNTS_COLLECTION,
		[
			"username_1",
			"email_unique_when_set",
			"providers.google_1",
			"providers.github_1",
			"telegram.chatId_1",
		],
	],
	[ONE_TIME_TOKENS_COLLECTION, ["kind_1_data.accountId_1", "data.accountId_1"]],
	[AUDIT_OUTBOX_COLLECTION, ["status_1_occurredAt_1"]],
	...[...GRANTABLE_MODELS].map((model): [string, readonly string[]] => [
		collectionNameFor(model),
		["grantId_1"],
	]),
	[collectionNameFor("DeviceCode"), ["grantId_1", "userCode_1"]],
	[collectionNameFor("Session"), ["uid_1", "payload.accountId_1"]],
	[collectionNameFor("Grant"), ["payload.accountId_1"]],
]);

export class UntaggedDataError extends Error {
	constructor(readonly remaining: number) {
		super(`${remaining} documents still have no tenantId`);
		this.name = "UntaggedDataError";
	}
}

/**
 * Runs at every startup, before serving: tags documents written before
 * tenants existed (they can only be the primary tenant's), then drops the
 * single-tenant indexes. Both steps are idempotent and cheap once done.
 * Tenant filters match `tenantId` exactly, so the server refuses to start
 * while any document is still untagged rather than hide it from its owner.
 */
export async function migrateToTenants(db: Db, logger: Logger): Promise<void> {
	const counts = await backfillTenantId(db, PRIMARY_TENANT_ID, {
		dryRun: false,
	});
	const tagged = counts.reduce((sum, count) => sum + count.tagged, 0);
	if (tagged > 0) logger.info({ tagged }, "Tagged pre-tenant documents");
	const dropped: string[] = [];
	for (const [name, indexes] of LEGACY_INDEXES) {
		const collection = db.collection(name);
		for (const index of indexes) {
			if (await collection.indexExists(index).catch(() => false)) {
				await collection.dropIndex(index);
				dropped.push(`${name}.${index}`);
			}
		}
	}
	if (dropped.length > 0) {
		logger.info({ dropped }, "Dropped single-tenant indexes");
	}
	const left = await backfillTenantId(db, PRIMARY_TENANT_ID, { dryRun: true });
	const remaining = left.reduce((sum, count) => sum + count.untagged, 0);
	if (remaining > 0) throw new UntaggedDataError(remaining);
}
