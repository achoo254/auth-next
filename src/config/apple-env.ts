import { type KeyObject, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";

/** Apple's 10-character Team ID and Key ID, e.g. `A1B2C3D4E5`. */
const appleId = z
	.string()
	.regex(/^[A-Z0-9]{10}$/, "must be the 10-character ID from Apple");

/** A reverse-DNS identifier, e.g. `com.hoandat.auth.signin`. */
const bundleLike = z
	.string()
	.regex(
		/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/,
		"must be a reverse-DNS identifier like com.example.signin",
	);

/**
 * Sign in with Apple (ADR 0008), primary tenant only. All four or none:
 * without them the Apple button is hidden and its routes answer 404. The
 * redirect URI is not configured: it is `${ISSUER}/oauth/apple/callback`,
 * like Google's and GitHub's. See docs/sign-in-with-apple.md.
 */
export const appleEnvShape = {
	APPLE_TEAM_ID: appleId.optional(),
	/** The Services ID: Apple's `client_id` for the web flow. */
	APPLE_SERVICES_ID: bundleLike.optional(),
	APPLE_KEY_ID: appleId.optional(),
	/** The Sign in with Apple key (.p8, PKCS#8 PEM), a read-only secret file. */
	APPLE_PRIVATE_KEY_PATH: z.string().min(1).optional(),
	/**
	 * Optional: the primary App ID (bundle ID) the Services ID is grouped
	 * with. Server-to-server notifications may name it as their audience.
	 */
	APPLE_PRIMARY_APP_ID: bundleLike.optional(),
};

const APPLE_KEYS = [
	"APPLE_TEAM_ID",
	"APPLE_SERVICES_ID",
	"APPLE_KEY_ID",
	"APPLE_PRIVATE_KEY_PATH",
] as const;

type AppleEnv = { readonly [K in keyof typeof appleEnvShape]?: string };

/** Reports an Apple configuration that is only partly set. */
export function checkAppleGroup(env: AppleEnv, ctx: z.RefinementCtx): void {
	const set = APPLE_KEYS.filter((key) => env[key] !== undefined);
	const partial = set.length > 0 && set.length < APPLE_KEYS.length;
	if (partial || (set.length === 0 && env.APPLE_PRIMARY_APP_ID)) {
		for (const key of APPLE_KEYS.filter((name) => env[name] === undefined)) {
			ctx.addIssue({
				code: "custom",
				path: [key],
				message: "must be set together with the other APPLE_* settings",
			});
		}
	}
}

export interface AppleSignInConfig {
	readonly teamId: string;
	readonly servicesId: string;
	readonly keyId: string;
	/** The ES256 key that signs the client secret; never leaves memory. */
	readonly privateKey: KeyObject;
	/** Accepted `aud` of server-to-server notifications. */
	readonly notificationAudiences: readonly string[];
}

/**
 * Reads the Apple key at startup. A missing or wrong file stops the IdP
 * with a message naming the variable, never the file's content.
 */
export function loadAppleKey(path: string): KeyObject {
	let key: KeyObject;
	try {
		key = createPrivateKey(readFileSync(path, "utf8"));
	} catch {
		throw new Error(
			"APPLE_PRIVATE_KEY_PATH: cannot read a PEM private key from that file",
		);
	}
	if (
		key.asymmetricKeyType !== "ec" ||
		key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
	) {
		throw new Error(
			"APPLE_PRIVATE_KEY_PATH: must be the Sign in with Apple key (EC P-256, .p8)",
		);
	}
	return key;
}

/** Undefined when Apple is not configured. */
export function appleSignInConfig(
	env: AppleEnv,
): AppleSignInConfig | undefined {
	const {
		APPLE_TEAM_ID: teamId,
		APPLE_SERVICES_ID: servicesId,
		APPLE_KEY_ID: keyId,
		APPLE_PRIVATE_KEY_PATH: keyPath,
		APPLE_PRIMARY_APP_ID: appId,
	} = env;
	if (!teamId || !servicesId || !keyId || !keyPath) return undefined;
	return {
		teamId,
		servicesId,
		keyId,
		privateKey: loadAppleKey(keyPath),
		notificationAudiences: appId ? [servicesId, appId] : [servicesId],
	};
}
