import { randomUUID } from "node:crypto";
import type { Collection, Filter } from "mongodb";
import {
	type AuditOutboxDocument,
	CONTEXT_RETENTION_MS,
	DELIVERED_RETENTION_MS,
	type LeasedEvent,
} from "./audit-outbox-model.js";

/** Lease operations on outbox events matching `filter` (the tenant's, AuditOutbox). */
export class AuditQueue {
	constructor(
		protected readonly outbox: Collection<AuditOutboxDocument>,
		private readonly filter: Filter<AuditOutboxDocument>,
	) {}

	/**
	 * Leases the oldest due event (by when it happened, so a burst of new
	 * events never pushes an older one back), so concurrent dispatchers never
	 * share one.
	 */
	async claimDue(now: Date, leaseMs: number): Promise<LeasedEvent | undefined> {
		const leaseId = randomUUID();
		const claimed = await this.outbox.findOneAndUpdate(
			{
				...this.filter,
				status: "pending",
				nextAttemptAt: { $lte: now },
				$or: [
					{ leaseUntil: { $exists: false } },
					{ leaseUntil: { $lte: now } },
				],
			},
			{ $set: { leaseUntil: new Date(now.getTime() + leaseMs), leaseId } },
			{ sort: { occurredAt: 1 }, returnDocument: "after" },
		);
		return claimed ? { ...claimed, leaseId } : undefined;
	}

	/** False when the lease moved to another dispatcher meanwhile. */
	async markDelivered(event: LeasedEvent, now: Date): Promise<boolean> {
		const result = await this.outbox.updateOne(
			{ _id: event._id, ...this.filter, leaseId: event.leaseId },
			{
				$set: {
					status: "delivered",
					deliveredAt: now,
					expiresAt: new Date(now.getTime() + DELIVERED_RETENTION_MS),
				},
				$unset: { leaseUntil: "", leaseId: "", lastError: "" },
			},
		);
		return result.matchedCount === 1;
	}

	/** Counts the attempt and schedules the next one (current holder only). */
	async markFailed(
		event: LeasedEvent,
		nextAttemptAt: Date,
		error: string,
	): Promise<boolean> {
		const result = await this.outbox.updateOne(
			{ _id: event._id, ...this.filter, leaseId: event.leaseId },
			{
				$inc: { attempts: 1 },
				$set: { nextAttemptAt, lastError: error },
				$unset: { leaseUntil: "", leaseId: "" },
			},
		);
		return result.matchedCount === 1;
	}

	/** Gives an event back untouched (the attempt was cut short by shutdown). */
	async release(event: LeasedEvent): Promise<void> {
		await this.outbox.updateOne(
			{ _id: event._id, ...this.filter, leaseId: event.leaseId },
			{ $unset: { leaseUntil: "", leaseId: "" } },
		);
	}

	/** Drops IP and User-Agent from events still undelivered after 30 days. */
	async scrubStaleContext(now: Date): Promise<number> {
		const result = await this.outbox.updateMany(
			{
				...this.filter,
				status: "pending",
				occurredAt: { $lte: new Date(now.getTime() - CONTEXT_RETENTION_MS) },
				context: { $exists: true },
			},
			{ $unset: { context: "" } },
		);
		return result.modifiedCount;
	}
}
