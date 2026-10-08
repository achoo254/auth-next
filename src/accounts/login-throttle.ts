import { type Collection, type Db, MongoServerError } from "mongodb";
import {
	DEVICE_POLICY,
	IDENTIFIER_POLICY,
	IP_POLICY,
	type Reservation,
	type ThrottlePolicy,
	type ThrottleSubject,
} from "./throttle-policy.js";

interface ThrottleDocument {
	_id: string;
	/** Attempts reserved in the current window (verified or refused). */
	attempts: number;
	lockedUntil?: Date;
	expiresAt: Date;
}

export const LOGIN_THROTTLE_COLLECTION = "login_throttle";

type Key = readonly [string, ThrottlePolicy];

export {
	DEVICE_POLICY,
	IDENTIFIER_POLICY,
	IP_POLICY,
	type Reservation,
	type ThrottlePolicy,
	type ThrottleSubject,
} from "./throttle-policy.js";

function isDuplicateKey(error: unknown): boolean {
	return error instanceof MongoServerError && error.code === 11000;
}

/**
 * Attempt budgets and temporary locks in MongoDB (TTL index, so a restart
 * keeps them). An attempt is reserved atomically *before* any password is
 * checked, so parallel requests cannot all slip past the count: at most
 * `maxAttempts` verifications happen per key and window. Missing accounts
 * are counted like real ones, so a lock reveals nothing.
 */
export class LoginThrottle {
	private readonly counters: Collection<ThrottleDocument>;

	constructor(
		db: Db,
		private readonly scope: string,
		private readonly identifierPolicy: ThrottlePolicy = IDENTIFIER_POLICY,
		private readonly ipPolicy: ThrottlePolicy = IP_POLICY,
	) {
		this.counters = db.collection<ThrottleDocument>(LOGIN_THROTTLE_COLLECTION);
	}

	private identifierKey(identifier: string): string {
		return `${this.scope}:id:${identifier}`;
	}

	private async isKeyLocked(key: string): Promise<boolean> {
		const locked = await this.counters.countDocuments(
			{ _id: key, lockedUntil: { $gt: new Date() } },
			{ limit: 1 },
		);
		return locked > 0;
	}

	/** The device key while that cookie keeps its exemption, else the account key. */
	private async keys(subject: ThrottleSubject): Promise<Key[]> {
		const deviceKey = subject.device
			? `${this.scope}:dev:${subject.device}`
			: undefined;
		const identity: Key =
			deviceKey && !(await this.isKeyLocked(deviceKey))
				? [deviceKey, DEVICE_POLICY]
				: [this.identifierKey(subject.identifier), this.identifierPolicy];
		return [identity, [`${this.scope}:ip:${subject.ip}`, this.ipPolicy]];
	}

	/** One atomic `$inc`; a locked key is never touched (so a lock never grows). */
	private async reserveKey(
		key: string,
		policy: ThrottlePolicy,
	): Promise<boolean> {
		const now = new Date();
		await this.counters.deleteOne({ _id: key, expiresAt: { $lte: now } });
		const notLocked = {
			_id: key,
			$or: [
				{ lockedUntil: { $exists: false } },
				{ lockedUntil: { $lte: now } },
			],
		};
		const update = {
			$inc: { attempts: 1 },
			$setOnInsert: { expiresAt: new Date(now.getTime() + policy.windowMs) },
		};
		// A duplicate key means the filter did not match an existing document:
		// it is locked, or a parallel request inserted it first (retry once).
		for (let attempt = 0; attempt < 2; attempt += 1) {
			try {
				const counter = await this.counters.findOneAndUpdate(
					notLocked,
					update,
					{
						upsert: true,
						returnDocument: "after",
					},
				);
				return counter !== null && counter.attempts <= policy.maxAttempts;
			} catch (error) {
				if (!isDuplicateKey(error)) throw error;
			}
		}
		return false;
	}

	/**
	 * Reserves one attempt on every key; undefined means refuse without
	 * checking the secret. The outcome is reported on the same keys.
	 */
	async reserve(subject: ThrottleSubject): Promise<Reservation | undefined> {
		const keys = await this.keys(subject);
		for (const [key, policy] of keys) {
			if (!(await this.reserveKey(key, policy))) return undefined;
		}
		const [identity, ip] = keys;
		return {
			// A key whose budget is used up gets locked.
			fail: async () => {
				const now = Date.now();
				for (const [key, policy] of keys) {
					const lockedUntil = new Date(now + policy.lockMs);
					await this.counters.updateOne(
						{ _id: key, attempts: { $gte: policy.maxAttempts } },
						{ $set: { lockedUntil, expiresAt: lockedUntil } },
					);
				}
			},
			// The account (or device) starts over; the IP gets its slot back.
			succeed: async () => {
				if (identity) {
					await this.counters.deleteOne({
						_id: identity[0],
						$or: [
							{ lockedUntil: { $exists: false } },
							{ lockedUntil: { $lte: new Date() } },
						],
					});
				}
				if (ip) {
					await this.counters.updateOne(
						{ _id: ip[0], attempts: { $gt: 0 } },
						{ $inc: { attempts: -1 } },
					);
				}
			},
		};
	}

	/** True while any key of the subject is locked (read-only). */
	async isLocked(subject: ThrottleSubject): Promise<boolean> {
		const locked = await this.counters.countDocuments(
			{
				_id: { $in: (await this.keys(subject)).map(([key]) => key) },
				lockedUntil: { $gt: new Date() },
			},
			{ limit: 1 },
		);
		return locked > 0;
	}

	/** Lifts locks on these identifiers, e.g. after a password reset. */
	async clear(identifiers: readonly string[]): Promise<void> {
		await this.counters.deleteMany({
			_id: { $in: identifiers.map((id) => this.identifierKey(id)) },
		});
	}
}

export async function ensureLoginThrottleIndexes(db: Db): Promise<void> {
	await db
		.collection(LOGIN_THROTTLE_COLLECTION)
		.createIndex(
			{ expiresAt: 1 },
			{ expireAfterSeconds: 0, name: "expiresAt_ttl" },
		);
}
