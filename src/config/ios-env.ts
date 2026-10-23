import { type KeyObject, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

/** Apple's 10-character Team ID or Key ID, e.g. `A1B2C3D4E5`. */
const appleId = z
	.string()
	.regex(/^[A-Z0-9]{10}$/, "must be the 10-character ID from Apple");

const bundleId = z
	.string()
	.regex(
		/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
		"must be a bundle ID like com.example.app",
	);

/**
 * The iOS account app (primary tenant only), all optional:
 * - `IOS_APP_ID` (`<TEAMID>.<bundle id>`) publishes the
 *   apple-app-site-association file; without it that file answers 404 and
 *   the app's universal links do not open it.
 * - `APNS_*` turn on push notices. The key is the APNs auth key (.p8), a
 *   read-only secret file. If any of the four is missing, push is off and
 *   the IdP runs as before.
 */
export const iosEnvShape = {
	IOS_APP_ID: z
		.string()
		.regex(
			/^[A-Z0-9]{10}\.[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
			"must be <TEAMID>.<bundle id>, e.g. A1B2C3D4E5.com.example.app",
		)
		.optional(),
	APNS_KEY_PATH: z.string().min(1).optional(),
	APNS_KEY_ID: appleId.optional(),
	APNS_TEAM_ID: appleId.optional(),
	/** The app's bundle ID (`apns-topic`). */
	APNS_TOPIC: bundleId.optional(),
};

type IosEnv = { readonly [K in keyof typeof iosEnvShape]?: string };

const APNS_KEYS = [
	"APNS_KEY_PATH",
	"APNS_KEY_ID",
	"APNS_TEAM_ID",
	"APNS_TOPIC",
] as const;

export interface ApnsConfig {
	readonly keyId: string;
	readonly teamId: string;
	readonly topic: string;
	/** Signs the provider tokens (ES256); never leaves memory. */
	readonly privateKey: KeyObject;
}

/** Names of the APNS_* variables set while others are missing (push off). */
export function partialApnsSettings(env: IosEnv): string[] {
	const set = APNS_KEYS.filter((key) => env[key] !== undefined);
	return set.length > 0 && set.length < APNS_KEYS.length ? set : [];
}

/**
 * Reads the APNs key at startup. A missing or wrong file stops the IdP with
 * a message naming the variable, never the file's content.
 */
export function loadApnsKey(path: string): KeyObject {
	let key: KeyObject;
	try {
		key = createPrivateKey(readFileSync(path, "utf8"));
	} catch {
		throw new Error(
			"APNS_KEY_PATH: cannot read a PEM private key from that file",
		);
	}
	if (
		key.asymmetricKeyType !== "ec" ||
		key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
	) {
		throw new Error("APNS_KEY_PATH: must be an APNs auth key (EC P-256, .p8)");
	}
	return key;
}

/** Undefined (push off) unless all four APNS_* settings are present. */
export function apnsConfig(env: IosEnv): ApnsConfig | undefined {
	const {
		APNS_KEY_PATH: keyPath,
		APNS_KEY_ID: keyId,
		APNS_TEAM_ID: teamId,
		APNS_TOPIC: topic,
	} = env;
	if (!keyPath || !keyId || !teamId || !topic) return undefined;
	return { keyId, teamId, topic, privateKey: loadApnsKey(keyPath) };
}
