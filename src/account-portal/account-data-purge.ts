import type { Filter } from "mongodb";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { AUDIT_OUTBOX_COLLECTION } from "../audit/audit-outbox-model.js";
import { GRANTABLE_MODELS, collectionNameFor } from "../oidc/mongo-adapter.js";
import { PUSH_DEVICES_COLLECTION } from "../push/push-devices.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { GRANT_META_COLLECTION } from "./device-grants.js";
import { SESSION_META_COLLECTION } from "./session-directory.js";

export interface PurgeCount {
	readonly collection: string;
	readonly count: number;
}

type AnyDocument = Record<string, unknown>;

interface AccountMatch {
	readonly collection: string;
	readonly filter: Filter<AnyDocument>;
}

/**
 * What still refers to an account in each tenant collection, other than
 * the account itself. Grants are matched by account as well as by id, so
 * an expired grant the TTL monitor has not removed yet is caught too.
 */
function accountFilters(
	accountId: string,
	grantIds: readonly string[],
): readonly AccountMatch[] {
	const byGrant: Filter<AnyDocument> = {
		$or: [
			{ grantId: { $in: [...grantIds] } },
			{ "payload.accountId": accountId },
		],
	};
	return [
		...[...GRANTABLE_MODELS].map((model) => ({
			collection: collectionNameFor(model),
			filter: byGrant,
		})),
		{
			collection: collectionNameFor("Grant"),
			filter: { "payload.accountId": accountId },
		},
		{
			collection: collectionNameFor("Session"),
			filter: { "payload.accountId": accountId },
		},
		{
			collection: collectionNameFor("Interaction"),
			filter: {
				$or: [
					{ "payload.session.accountId": accountId },
					{ "payload.result.login.accountId": accountId },
				],
			},
		},
		{ collection: SESSION_META_COLLECTION, filter: { accountId } },
		{ collection: GRANT_META_COLLECTION, filter: { accountId } },
		{ collection: PUSH_DEVICES_COLLECTION, filter: { accountId } },
		{
			collection: ONE_TIME_TOKENS_COLLECTION,
			filter: { "data.accountId": accountId },
		},
	];
}

/**
 * Deletes every document of the tenant that belongs to the account, except
 * the account itself (deleted last, by the repository), and strips what
 * could identify the person from its audit events (IP, User-Agent, device
 * name): the event type, its time, `sub` and ids such as a client remain
 * (ADR 0009). Works from the database alone, so a deletion that
 * stopped half way can be finished without the provider.
 */
export async function purgeAccountData(
	{ db, tenant }: TenantDb,
	accountId: string,
): Promise<PurgeCount[]> {
	const scope = inTenant(tenant);
	const grantIds = (
		await db
			.collection<{ _id: string }>(collectionNameFor("Grant"))
			.find(
				{ "payload.accountId": accountId, ...scope },
				{ projection: { _id: 1 } },
			)
			.toArray()
	).map((grant) => grant._id);
	const counts: PurgeCount[] = [];
	for (const { collection, filter } of accountFilters(accountId, grantIds)) {
		const result = await db
			.collection<AnyDocument>(collection)
			.deleteMany({ ...filter, ...scope });
		counts.push({ collection, count: result.deletedCount });
	}
	const audit = await db
		.collection(AUDIT_OUTBOX_COLLECTION)
		.updateMany(
			{ sub: accountId, ...scope },
			{ $unset: { context: "", "data.deviceName": "" } },
		);
	counts.push({
		collection: AUDIT_OUTBOX_COLLECTION,
		count: audit.modifiedCount,
	});
	return counts;
}
