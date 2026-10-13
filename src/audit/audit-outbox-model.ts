import type { Collection, Db } from "mongodb";
import type {
	AuditContext,
	AuditData,
	AuditEventType,
} from "./audit-events.js";

export const AUDIT_OUTBOX_COLLECTION = "audit_outbox";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Delivered events are kept this long (for support), then MongoDB drops them. */
export const DELIVERED_RETENTION_MS = 30 * DAY_MS;
/** Undelivered events lose their IP and User-Agent after this long. */
export const CONTEXT_RETENTION_MS = 30 * DAY_MS;

/** One credential event waiting for (or past) delivery to Localman. */
export interface AuditOutboxDocument {
	/** Event id: the SET `jti` and the Idempotency-Key of every attempt. */
	_id: string;
	/** Whose account it is about; absent only on pre-tenant events. */
	tenantId?: string | null;
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
		outbox.createIndex({ tenantId: 1, status: 1, occurredAt: 1 }),
		outbox.createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
		),
	]);
}
