import type { AuditDeliveryConfig } from "../config/integrations-env.js";
import type { AuditOutboxDocument } from "./audit-outbox.js";
import type { SecurityEventSigner } from "./security-event-token.js";

/** Where and how events are sent; absent, events stay in the outbox. */
export interface AuditDelivery {
	readonly config: AuditDeliveryConfig;
	readonly sign: SecurityEventSigner;
}

/** The target and signer for one event (its tenant's), or none yet. */
export type AuditDeliveryResolver = (
	event: AuditOutboxDocument,
) => Promise<AuditDelivery | undefined>;

const FIRST_RETRY_MS = 5_000;
/** Backoff ceiling: a long Localman outage is retried hourly, never dropped. */
export const MAX_RETRY_MS = 60 * 60 * 1000;

/** Delay before the next attempt once `attempts` attempts have failed. */
export function retryDelayMs(attempts: number): number {
	const exponent = Math.min(Math.max(attempts - 1, 0), 20);
	return Math.min(FIRST_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
}

/**
 * `Basic base64(id:secret)`, exactly as the integration guide documents
 * (the id cannot contain ":", see integrations-env.ts).
 */
export function basicAuthorization(config: AuditDeliveryConfig): string {
	const credentials = `${config.clientId}:${config.clientSecret}`;
	return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

/** A short, secret-free description of a failed request. */
export function errorCode(cause: unknown): string {
	if (!(cause instanceof Error)) return "error";
	const inner: unknown = cause.cause;
	const code = inner instanceof Error ? Reflect.get(inner, "code") : undefined;
	return typeof code === "string" ? code : cause.name;
}
