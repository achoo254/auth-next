import type { AuditDeliveryConfig } from "../config/integrations-env.js";
import type { Logger } from "../logger.js";
import type { AuditOutboxDocument, LeasedEvent } from "./audit-outbox.js";
import type { AuditQueue } from "./audit-queue.js";
import { SET_TYPE, type SecurityEventSigner } from "./security-event-token.js";

const FIRST_RETRY_MS = 5_000;
/** Backoff ceiling: a long Localman outage is retried hourly, never dropped. */
export const MAX_RETRY_MS = 60 * 60 * 1000;

/** Delay before the next attempt once `attempts` attempts have failed. */
export function retryDelayMs(attempts: number): number {
	const exponent = Math.min(Math.max(attempts - 1, 0), 20);
	return Math.min(FIRST_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
}

/** Undelivered events are scrubbed of IP/User-Agent this often at most. */
const SCRUB_INTERVAL_MS = 60 * 60 * 1000;

/** Where and how events are sent; absent, events stay in the outbox. */
export interface AuditDelivery {
	readonly config: AuditDeliveryConfig;
	readonly sign: SecurityEventSigner;
}

/** The target and signer for one event (its tenant's), or none yet. */
export type AuditDeliveryResolver = (
	event: AuditOutboxDocument,
) => Promise<AuditDelivery | undefined>;

export interface AuditDispatcherOptions {
	/** One tenant's outbox, or every tenant's (allTenantsAuditQueue). */
	readonly outbox: AuditQueue;
	/** Absent: delivery is off and the dispatcher only scrubs old events. */
	readonly deliveryFor?: AuditDeliveryResolver;
	readonly logger: Logger;
	readonly pollIntervalMs?: number;
	readonly requestTimeoutMs?: number;
	/** Events sent per poll at most, so one poll stays short. */
	readonly batchSize?: number;
	readonly fetch?: typeof fetch;
	readonly now?: () => Date;
}

type Outcome = "delivered" | "failed" | "released";

/**
 * Pushes outbox events to Localman (RFC 8935 style): POST of the signed SET
 * with `Content-Type: application/secevent+jwt`, HTTP Basic client
 * credentials and the event id as `Idempotency-Key`. A 2xx marks the event
 * delivered; anything else (5xx, 4xx, network, timeout) keeps it pending
 * with capped exponential backoff, so nothing is lost while Localman is
 * down or misconfigured. Response bodies are never read or logged. Without
 * a delivery target it only scrubs IP/User-Agent from old pending events.
 */
export class AuditDispatcher {
	private readonly fetch: typeof fetch;
	private readonly now: () => Date;
	private readonly stopping = new AbortController();
	private timer: NodeJS.Timeout | undefined;
	private running: Promise<void> | undefined;
	private lastScrub = 0;

	constructor(private readonly options: AuditDispatcherOptions) {
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? (() => new Date());
	}

	/** Polls in the background until `stop`. */
	start(): void {
		if (this.timer || this.stopping.signal.aborted) return;
		this.schedule(0);
	}

	/** Stops polling, aborts an attempt in flight and waits for the poll to end. */
	async stop(): Promise<void> {
		this.stopping.abort();
		clearTimeout(this.timer);
		this.timer = undefined;
		await this.running;
	}

	/** One poll: sends due events until none is left or the batch is used up. */
	async dispatchDue(): Promise<{ delivered: number; failed: number }> {
		const counts = { delivered: 0, failed: 0 };
		const { deliveryFor } = this.options;
		if (!deliveryFor) return counts;
		const batch = this.options.batchSize ?? 20;
		const leaseMs = 3 * (this.options.requestTimeoutMs ?? 10_000);
		for (let index = 0; index < batch; index += 1) {
			if (this.stopping.signal.aborted) break;
			const event = await this.options.outbox.claimDue(this.now(), leaseMs);
			if (!event) break;
			const outcome = await this.dispatchOne(event, deliveryFor);
			if (outcome === "delivered") counts.delivered += 1;
			if (outcome === "failed") counts.failed += 1;
		}
		return counts;
	}

	private schedule(delayMs: number): void {
		this.timer = setTimeout(() => {
			this.running = this.poll();
		}, delayMs);
		this.timer.unref();
	}

	private async poll(): Promise<void> {
		try {
			const now = this.now();
			if (now.getTime() - this.lastScrub >= SCRUB_INTERVAL_MS) {
				await this.options.outbox.scrubStaleContext(now);
				this.lastScrub = now.getTime();
			}
			await this.dispatchDue();
		} catch (error) {
			this.options.logger.warn({ err: error }, "Audit dispatch failed");
		}
		if (!this.stopping.signal.aborted) {
			this.schedule(this.options.pollIntervalMs ?? 5_000);
		}
	}

	/**
	 * Resolves the event's target and signer, then sends it. A tenant whose
	 * signer cannot be built (a secret that no longer opens, MongoDB down)
	 * only postpones its own events: older events of a broken tenant must
	 * never block everyone else's.
	 */
	private async dispatchOne(
		event: LeasedEvent,
		deliveryFor: AuditDeliveryResolver,
	): Promise<Outcome> {
		let delivery: AuditDelivery | undefined;
		try {
			delivery = await deliveryFor(event);
		} catch (error) {
			this.options.logger.warn(
				{ eventId: event._id, error: errorCode(error) },
				"Audit signer unavailable",
			);
			return this.postpone(event, "signer unavailable");
		}
		return delivery
			? this.deliver(event, delivery)
			: this.postpone(event, "no delivery target");
	}

	/** Keeps an event whose tenant has no target now; it is retried with backoff. */
	private async postpone(event: LeasedEvent, error: string): Promise<Outcome> {
		const attempts = event.attempts + 1;
		const next = new Date(this.now().getTime() + retryDelayMs(attempts));
		await this.options.outbox.markFailed(event, next, error);
		return "failed";
	}

	private async deliver(
		event: LeasedEvent,
		delivery: AuditDelivery,
	): Promise<Outcome> {
		const { outbox, logger } = this.options;
		const timeout = AbortSignal.timeout(
			this.options.requestTimeoutMs ?? 10_000,
		);
		let error: string;
		try {
			const response = await this.fetch(delivery.config.url, {
				method: "POST",
				headers: {
					authorization: basicAuthorization(delivery.config),
					"content-type": `application/${SET_TYPE}`,
					accept: "application/json",
					"idempotency-key": event._id,
				},
				body: await delivery.sign(event),
				signal: AbortSignal.any([this.stopping.signal, timeout]),
				redirect: "error",
			});
			await response.body?.cancel();
			if (response.ok) {
				if (!(await outbox.markDelivered(event, this.now()))) {
					logger.warn({ eventId: event._id }, "Audit event lease lost");
				}
				return "delivered";
			}
			error = `HTTP ${response.status}`;
		} catch (cause) {
			if (this.stopping.signal.aborted) {
				await outbox.release(event);
				return "released";
			}
			error = errorCode(cause);
		}
		const attempts = event.attempts + 1;
		const next = new Date(this.now().getTime() + retryDelayMs(attempts));
		if (!(await outbox.markFailed(event, next, error))) {
			logger.warn({ eventId: event._id }, "Audit event lease lost");
		}
		logger.warn(
			{ eventId: event._id, type: event.type, attempts, error, retryAt: next },
			"Audit event not delivered; will retry",
		);
		return "failed";
	}
}

/**
 * `Basic base64(id:secret)`, exactly as the integration guide documents
 * (the id cannot contain ":", see integrations-env.ts).
 */
function basicAuthorization(config: AuditDeliveryConfig): string {
	const credentials = `${config.clientId}:${config.clientSecret}`;
	return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

/** A short, secret-free description of a failed request. */
function errorCode(cause: unknown): string {
	if (!(cause instanceof Error)) return "error";
	const inner: unknown = cause.cause;
	const code = inner instanceof Error ? Reflect.get(inner, "code") : undefined;
	return typeof code === "string" ? code : cause.name;
}
