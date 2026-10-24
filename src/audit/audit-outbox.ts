import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { Logger } from "../logger.js";
import {
	type TenantScope,
	inTenant,
	tenantTag,
} from "../tenants/tenant-data.js";
import type {
	AuditContext,
	AuditEventData,
	AuditEventType,
} from "./audit-events.js";
import { auditOutboxCollection } from "./audit-outbox-model.js";
import { AuditQueue } from "./audit-queue.js";

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
 * Its lease operations see only the tenant's events; the dispatcher leases
 * from it and signs each event as the tenant's issuer.
 */
export class AuditOutbox extends AuditQueue {
	constructor(
		db: Db,
		readonly tenant: TenantScope,
		private readonly logger: Logger,
	) {
		super(auditOutboxCollection(db), inTenant(tenant));
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
}
