import { randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { type Logger, createLogger } from "../logger.js";
import type {
	AuditContext,
	AuditData,
	AuditEventData,
	AuditEventType,
} from "./audit-events.js";

export const AUDIT_OUTBOX_COLLECTION = "audit_outbox";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Delivered events are kept this long (for support), then MongoDB drops them. */
const DELIVERED_RETENTION_MS = 30 * DAY_MS;
/** Undelivered events lose their IP and User-Agent after this long. */
export const CONTEXT_RETENTION_MS = 30 * DAY_MS;

/** One credential event waiting for (or past) delivery to Localman. */
export interface AuditOutboxDocument {
	/** Event id: the SET `jti` and the Idempotency-Key of every attempt. */
	_id: string;
	type: AuditEventType;
	/** The account the event is about (OIDC `sub`). */
	sub: string;
	/** When it happened; delivery goes oldest first. */
	occurredAt: Date;
	data: AuditData;
	context?: AuditContext;
	status: "pending" | "delivered";
	attempts: number;
	nextAttemptAt: Date;
	/** A dispatcher holds the event until then; expired leases are retaken. */
	leaseUntil?: Date;
	/** Who holds the lease; outcomes are only stored by the current holder. */
	leaseId?: string;
	/** HTTP status or error code of the last failed attempt; never a body. */
	lastError?: string;
	deliveredAt?: Date;
	/** Set on delivery; the TTL index removes the document afterwards. */
	expiresAt?: Date;
}

/** An event leased to one dispatcher attempt. */
export type LeasedEvent = AuditOutboxDocument & { leaseId: string };

export function auditOutboxCollection(db: Db): Collection<AuditOutboxDocument> {
	return db.collection<AuditOutboxDocument>(AUDIT_OUTBOX_COLLECTION);
}

/** Idempotent; run at startup with the other account-layer indexes. */
export async function ensureAuditOutboxIndexes(db: Db): Promise<void> {
	const outbox = auditOutboxCollection(db);
	await Promise.all([
		outbox.createIndex({ status: 1, occurredAt: 1 }),
		outbox.createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
		),
	]);
}

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
 */
export class AuditOutbox {
	private readonly outbox: Collection<AuditOutboxDocument>;

	constructor(
		db: Db,
		private readonly logger: Logger = createLogger("info"),
	) {
		this.outbox = auditOutboxCollection(db);
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
			{ _id: event._id, leaseId: event.leaseId },
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
			{ _id: event._id, leaseId: event.leaseId },
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
			{ _id: event._id, leaseId: event.leaseId },
			{ $unset: { leaseUntil: "", leaseId: "" } },
		);
	}

	/** Drops IP and User-Agent from events still undelivered after 30 days. */
	async scrubStaleContext(now: Date): Promise<number> {
		const result = await this.outbox.updateMany(
			{
				status: "pending",
				occurredAt: { $lte: new Date(now.getTime() - CONTEXT_RETENTION_MS) },
				context: { $exists: true },
			},
			{ $unset: { context: "" } },
		);
		return result.modifiedCount;
	}
}
