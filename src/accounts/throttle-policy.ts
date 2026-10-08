const MINUTE_MS = 60_000;

export interface ThrottlePolicy {
	/** Attempts allowed per window; failing the last of them locks the key. */
	readonly maxAttempts: number;
	readonly windowMs: number;
	readonly lockMs: number;
}

/** Five wrong attempts per account (or unknown identifier): 15-minute lock. */
export const IDENTIFIER_POLICY: ThrottlePolicy = {
	maxAttempts: 5,
	windowMs: 15 * MINUTE_MS,
	lockMs: 15 * MINUTE_MS,
};

/** One IP (or IPv6 /64) may try more often (shared NAT), but not without bound. */
export const IP_POLICY: ThrottlePolicy = {
	maxAttempts: 50,
	windowMs: 15 * MINUTE_MS,
	lockMs: 15 * MINUTE_MS,
};

/**
 * One remembered browser may skip the account budget, but has its own:
 * five wrong attempts and that cookie loses the exemption for good (until a
 * successful sign-in issues a new one).
 */
export const DEVICE_POLICY: ThrottlePolicy = {
	maxAttempts: 5,
	windowMs: 15 * MINUTE_MS,
	lockMs: 90 * 24 * 60 * MINUTE_MS,
};

export interface ThrottleSubject {
	/** The account id when the account exists, else the normalised identifier. */
	readonly identifier: string;
	/** Client IP, IPv6 grouped to its /64 (see ipThrottleKey). */
	readonly ip: string;
	/**
	 * Signature of a device cookie that is valid for this account: that
	 * browser signed in before with the current credentials. It is counted
	 * on its own budget instead of the account's, so guessing from elsewhere
	 * cannot lock its owner out; the IP budget always applies.
	 */
	readonly device?: string;
}

/** A reserved attempt; report its outcome on the keys it was counted on. */
export interface Reservation {
	/** `accountLocked`: this failure started a lock on the account's budget. */
	fail(): Promise<{ readonly accountLocked: boolean }>;
	succeed(): Promise<void>;
}
