import { randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import {
	type TenantScope,
	inTenant,
	tenantTag,
} from "../tenants/tenant-data.js";

export const DELETION_NOTICES_COLLECTION = "deletion_notices";

/**
 * One app still to be told that an account was deleted (ADR 0018). It
 * outlives the account on purpose: the app must hear of it even when it is
 * down for days. The document is removed once the app answered 2xx.
 */
export interface DeletionNoticeDocument {
	/** The SET's `jti`, the same on every attempt. */
	_id: string;
	tenantId: string;
	/** The deleted account. */
	sub: string;
	/** The app's receiver, also the SET's `aud`. */
	url: string;
	/** When the account was deleted (`toe`). */
	deletedAt: Date;
	attempts: number;
	nextAttemptAt: Date;
	leaseUntil?: Date;
	leaseId?: string;
	lastError?: string;
}

export type LeasedNotice = DeletionNoticeDocument & {
	readonly leaseId: string;
};

export async function ensureDeletionNoticeIndexes(db: Db): Promise<void> {
	await db
		.collection(DELETION_NOTICES_COLLECTION)
		.createIndex(
			{ tenantId: 1, nextAttemptAt: 1 },
			{ name: "tenant_next_attempt" },
		);
}

/** The tenant's pending deletion notices, leased one at a time. */
export class DeletionNotices {
	private readonly notices: Collection<DeletionNoticeDocument>;

	constructor(
		db: Db,
		private readonly tenant: TenantScope,
	) {
		this.notices = db.collection(DELETION_NOTICES_COLLECTION);
	}

	/** One notice per receiver; nothing when no app is configured. */
	async enqueue(
		sub: string,
		urls: readonly string[],
		now = new Date(),
	): Promise<void> {
		if (urls.length === 0) return;
		await this.notices.insertMany(
			urls.map((url) => ({
				_id: randomUUID(),
				...tenantTag(this.tenant),
				sub,
				url,
				deletedAt: now,
				attempts: 0,
				nextAttemptAt: now,
			})),
		);
	}

	/** Leases the oldest due notice so concurrent dispatchers never share one. */
	async claimDue(
		now: Date,
		leaseMs: number,
	): Promise<LeasedNotice | undefined> {
		const leaseId = randomUUID();
		const claimed = await this.notices.findOneAndUpdate(
			{
				...inTenant(this.tenant),
				nextAttemptAt: { $lte: now },
				$or: [
					{ leaseUntil: { $exists: false } },
					{ leaseUntil: { $lte: now } },
				],
			},
			{ $set: { leaseUntil: new Date(now.getTime() + leaseMs), leaseId } },
			{ sort: { nextAttemptAt: 1 }, returnDocument: "after" },
		);
		return claimed ? { ...claimed, leaseId } : undefined;
	}

	/** The app has it: the notice is done. */
	async markDelivered(notice: LeasedNotice): Promise<void> {
		await this.notices.deleteOne({
			_id: notice._id,
			...inTenant(this.tenant),
			leaseId: notice.leaseId,
		});
	}

	async markFailed(
		notice: LeasedNotice,
		nextAttemptAt: Date,
		error: string,
	): Promise<void> {
		await this.notices.updateOne(
			{ _id: notice._id, ...inTenant(this.tenant), leaseId: notice.leaseId },
			{
				$inc: { attempts: 1 },
				$set: { nextAttemptAt, lastError: error },
				$unset: { leaseUntil: "", leaseId: "" },
			},
		);
	}
}
