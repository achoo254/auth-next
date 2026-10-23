import type { ApnsEnvironment } from "./push-devices.js";

/** A phone to notify. */
export interface PushTarget {
	readonly token: string;
	readonly environment: ApnsEnvironment;
}

export type PushResult =
	| { readonly status: "sent" }
	/** 410: the app is gone from the phone (since `at`, when Apple says). */
	| { readonly status: "unregistered"; readonly at?: Date }
	/** The token is not a token of this app or environment. */
	| { readonly status: "bad-token" }
	| { readonly status: "failed" };

/** Delivers one notice to one phone; never throws. */
export interface PushSender {
	send(target: PushTarget, payload: object): Promise<PushResult>;
	close(): void;
}

export const BAD_TOKEN_REASONS = new Set([
	"BadDeviceToken",
	"DeviceTokenNotForTopic",
	"TopicDisallowed",
]);
export const STALE_PROVIDER_TOKEN = new Set([
	"ExpiredProviderToken",
	"InvalidProviderToken",
]);

export interface ApnsAnswer {
	readonly status: number;
	readonly reason?: string;
	readonly timestamp?: number;
}

/** Status and Apple's JSON (`reason`, `timestamp`), whatever the body. */
export function parseAnswer(status: number, body: string): ApnsAnswer {
	if (!body) return { status };
	try {
		const parsed: unknown = JSON.parse(body);
		if (typeof parsed !== "object" || parsed === null) return { status };
		const reason: unknown = Reflect.get(parsed, "reason");
		const timestamp: unknown = Reflect.get(parsed, "timestamp");
		return {
			status,
			...(typeof reason === "string" ? { reason } : {}),
			...(typeof timestamp === "number" ? { timestamp } : {}),
		};
	} catch {
		return { status };
	}
}
