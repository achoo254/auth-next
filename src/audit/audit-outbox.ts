import { randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import type { Logger } from "../logger.js";
import {
	type TenantFilter,
	type TenantScope,
	inTenant,
	tenantTag,
} from "../tenants/tenant-data.js";
import type {
	AuditContext,
	AuditEventData,
	AuditEventType,
} from "./audit-events.js";
import {
	type AuditOutboxDocument,
	CONTEXT_RETENTION_MS,
	DELIVERED_RETENTION_MS,
	type LeasedEvent,
	auditOutboxCollection,
} from "./audit-outbox-model.js";

export {
	AUDIT_OUTBOX_COLLECTION,
	type AuditOutboxDocument,
	CONTEXT_RETENTION_MS,
	type LeasedEvent,
	auditOutboxCollection,
	ensureAuditOutboxIndexes,
} from "./audit-outbox-model.js";

function errorName(error: unknown): string {
	if (!(error instanceof Error)) return "error";
	const code: unknown = Reflect.get(error, "code");
	return code === undefined ? error.name : `${error.name} ${String(code)}`;
}

/**
 * The outbox of credential events. Writers call `record` right after the
 * change it describes is stored, so an event survives any outage of
 * Localman; the dispatcher delivers it later. Recording never throws: the
 * security step it follows has already happened and must not fail because
 * of the audit trail, so a failed write is logged (type and account only).
 * One outbox per tenant: its events are only ever leased by that tenant's
 * dispatcher, which signs them as that tenant's issuer.
 */
export class AuditOutbox {
	private readonly outbox: Collection<AuditOutboxDocument>;
	private readonly scope: TenantFilter;

	constructor(
		db: Db,
		readonly tenant: TenantScope,
		private readonly logger: Logger,
	) {
		this.outbox = auditOutboxCollection(db);
		this.scope = inTenant(tenant);
	}

	/** Stores a pending event; returns its id, or undefined if it was lost. */
	async record<T extends AuditEventType>(
		type: T,
		sub: string,
		data: AuditEventData[T],
		context?: AuditContext,
	): Promise<string | undefined> {
		const now = new Date();
		const id = randomUUID();
		try {
			await this.outbox.insertOne(
				{
					_id: id,
					...tenantTag(this.tenant),
					type,
					sub,
					occurredAt: now,
					data,
					...(context ? { context } : {}),
					status: "pending",
					attempts: 0,
					nextAttemptAt: now,
				},
				{ ignoreUndefined: true },
			);
			return id;
		} catch (error) {
			this.logger.error(
				{ type, accountId: sub, error: errorName(error) },
				"Audit event not recorded",
			);
			return undefined;
		}
	}

	/**
	 * Leases the oldest due event (by when it happened, so a burst of new
	 * events never pushes an older one back), so concurrent dispatchers never
	 * share one.
	 */
	async claimDue(now: Date, leaseMs: number): Promise<LeasedEvent | undefined> {
		const leaseId = randomUUID();
		const claimed = await this.outbox.findOneAndUpdate(
			{
				...this.scope,
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
			{ _id: event._id, ...this.scope, leaseId: event.leaseId },
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
			{ _id: event._id, ...this.scope, leaseId: event.leaseId },
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
			{ _id: event._id, ...this.scope, leaseId: event.leaseId },
			{ $unset: { leaseUntil: "", leaseId: "" } },
		);
	}

	/** Drops IP and User-Agent from events still undelivered after 30 days. */
	async scrubStaleContext(now: Date): Promise<number> {
		const result = await this.outbox.updateMany(
			{
				...this.scope,
				status: "pending",
				occurredAt: { $lte: new Date(now.getTime() - CONTEXT_RETENTION_MS) },
				context: { $exists: true },
			},
			{ $unset: { context: "" } },
		);
		return result.modifiedCount;
	}
}
