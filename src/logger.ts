import {
	type DestinationStream,
	type LevelWithSilent,
	type Logger,
	pino,
} from "pino";

export type { Logger };

const SAIGON_OFFSET_MS = 7 * 60 * 60 * 1000;

/** ISO-8601 timestamp in Asia/Saigon (UTC+7, no DST), e.g. 2026-10-08T17:07:00.123+07:00. */
function saigonTimestamp(): string {
	const local = new Date(Date.now() + SAIGON_OFFSET_MS).toISOString();
	return `,"time":"${local.replace("Z", "+07:00")}"`;
}

/**
 * Credentials and tokens must never reach the logs. Paths cover request
 * headers and the token-bearing fields oidc-provider puts on its errors.
 */
const REDACT_PATHS = [
	"req.headers.authorization",
	"req.headers.cookie",
	"res.headers['set-cookie']",
	"*.client_secret",
	"*.access_token",
	"*.refresh_token",
	"*.id_token",
	"*.code",
	"*.device_code",
	"*.subject_token",
	"*.actor_token",
	"*.password",
];

/** `destination` defaults to stdout; tests pass a stream to read the lines. */
export function createLogger(
	level: LevelWithSilent,
	destination?: DestinationStream,
): Logger {
	const options = {
		level,
		base: { service: "hoandat-auth" },
		timestamp: saigonTimestamp,
		redact: { paths: REDACT_PATHS, censor: "[redacted]" },
	};
	return destination ? pino(options, destination) : pino(options);
}
