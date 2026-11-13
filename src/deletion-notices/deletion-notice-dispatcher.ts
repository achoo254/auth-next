import { SignJWT, importJWK } from "jose";
import { AUDIT_EVENT_URI_PREFIX } from "../audit/audit-events.js";
import { errorCode, retryDelayMs } from "../audit/audit-request.js";
import {
	SET_LIFETIME_SECONDS,
	SET_TYPE,
} from "../audit/security-event-token.js";
import type { Logger } from "../logger.js";
import {
	SIGNING_ALG,
	type SigningJwks,
	primarySigningKey,
} from "../oidc/jwks.js";
import type { DeletionNotices, LeasedNotice } from "./deletion-notice-queue.js";

/** The one event a deletion notice carries (ADR 0018). */
export const ACCOUNT_DELETED_EVENT = `${AUDIT_EVENT_URI_PREFIX}account.deleted`;

const REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;

function epochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

/**
 * Signs the SET of one notice: `aud` is the app's exact receiver, `jti` the
 * notice id (the same on every attempt), `toe` when the account went.
 */
export function deletionNoticeSigner(options: {
	readonly issuer: string;
	readonly jwks: SigningJwks;
}): (notice: LeasedNotice, now: Date) => Promise<string> {
	const signingKey = primarySigningKey(options.jwks);
	const { kid } = signingKey;
	let key: ReturnType<typeof importJWK> | undefined;
	return async (notice, now) => {
		key ??= importJWK({ ...signingKey }, SIGNING_ALG);
		const signedAt = epochSeconds(now);
		return new SignJWT({
			toe: epochSeconds(notice.deletedAt),
			events: { [ACCOUNT_DELETED_EVENT]: {} },
		})
			.setProtectedHeader({ alg: SIGNING_ALG, kid, typ: SET_TYPE })
			.setIssuer(options.issuer)
			.setAudience(notice.url)
			.setSubject(notice.sub)
			.setJti(notice._id)
			.setIssuedAt(signedAt)
			.setExpirationTime(signedAt + SET_LIFETIME_SECONDS)
			.sign(await key);
	};
}

/**
 * Tells every configured app that an account was deleted (ADR 0018): POST
 * of the signed SET, `Content-Type: application/secevent+jwt`. A 2xx
 * removes the notice; anything else keeps it with capped exponential
 * backoff, so an app that is down hears of it once it is back. Response
 * bodies are never read or logged.
 */
export class DeletionNoticeDispatcher {
	private timer: NodeJS.Timeout | undefined;
	private running: Promise<void> | undefined;
	private readonly stopping = new AbortController();
	private readonly fetch: typeof fetch;
	private readonly now: () => Date;

	constructor(
		private readonly options: {
			readonly notices: DeletionNotices;
			readonly sign: (notice: LeasedNotice, now: Date) => Promise<string>;
			readonly logger: Logger;
			readonly fetch?: typeof fetch;
			readonly now?: () => Date;
		},
	) {
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? (() => new Date());
	}

	start(): void {
		if (this.timer || this.stopping.signal.aborted) return;
		this.schedule(0);
	}

	async stop(): Promise<void> {
		this.stopping.abort();
		clearTimeout(this.timer);
		this.timer = undefined;
		await this.running;
	}

	/** One poll: sends due notices until none is left or the batch is used up. */
	async dispatchDue(): Promise<{ delivered: number; failed: number }> {
		const counts = { delivered: 0, failed: 0 };
		for (let index = 0; index < BATCH_SIZE; index += 1) {
			if (this.stopping.signal.aborted) break;
			const notice = await this.options.notices.claimDue(
				this.now(),
				3 * REQUEST_TIMEOUT_MS,
			);
			if (!notice) break;
			if (await this.deliver(notice)) counts.delivered += 1;
			else counts.failed += 1;
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
			await this.dispatchDue();
		} catch (error) {
			this.options.logger.warn(
				{ err: error },
				"Deletion notice dispatch failed",
			);
		}
		if (!this.stopping.signal.aborted) this.schedule(POLL_INTERVAL_MS);
	}

	private async deliver(notice: LeasedNotice): Promise<boolean> {
		const { notices, logger } = this.options;
		let error: string;
		try {
			const response = await this.fetch(notice.url, {
				method: "POST",
				headers: { "content-type": `application/${SET_TYPE}` },
				body: await this.options.sign(notice, this.now()),
				signal: AbortSignal.any([
					AbortSignal.timeout(REQUEST_TIMEOUT_MS),
					this.stopping.signal,
				]),
			});
			await response.body?.cancel();
			if (response.ok) {
				await notices.markDelivered(notice);
				logger.info({ noticeId: notice._id }, "Deletion notice delivered");
				return true;
			}
			error = `HTTP ${response.status}`;
		} catch (cause) {
			error = errorCode(cause);
		}
		const attempts = notice.attempts + 1;
		await notices.markFailed(
			notice,
			new Date(this.now().getTime() + retryDelayMs(attempts)),
			error,
		);
		logger.warn(
			{ noticeId: notice._id, attempts, error },
			"Deletion notice not delivered",
		);
		return false;
	}
}
