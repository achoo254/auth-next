import { createHmac } from "node:crypto";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";

/**
 * Secrets of a tenant's confidential first-party clients; `scribeWeb` is a
 * registry tenant's (the primary tenant's comes from the environment).
 */
export interface StaticClientSecrets {
	readonly localmanWeb: string;
	readonly tuneloWeb: string;
	readonly chatWeb: string;
	readonly scribeWeb?: string;
}

function hmac(key: string, message: string): string {
	return createHmac("sha256", key).update(message, "utf8").digest("base64url");
}

/**
 * The key one app holds to compute its own client secret in every tenant:
 * HMAC-SHA256 of `app-client-key\n<clientId>` under `APP_CLIENT_SECRET_KEY`
 * (which only the IdP holds), base64url. Localman gets the key of
 * `localman-web`, Tunelo the key of `tunelo-web`, chat the key of
 * `chat-web`, Scribe the key of `scribe-web`, so a leak at one app never
 * yields another's secrets.
 */
export function appClientKey(masterKey: string, clientId: string): string {
	return hmac(masterKey, `app-client-key\n${clientId}`);
}

/**
 * Client secret of a confidential first-party app in a tenant other than
 * the primary one: HMAC-SHA256 of the tenant id under the app's key,
 * base64url. The app computes the same value for each tenant it serves, so
 * no API ever hands a secret out and owners never see or rotate one.
 * Rotating APP_CLIENT_SECRET_KEY rotates every derived secret at once.
 */
export function derivedClientSecret(
	masterKey: string,
	tenantId: string,
	clientId: string,
): string {
	return hmac(appClientKey(masterKey, clientId), tenantId);
}

export function derivedClientSecrets(
	masterKey: string,
	tenantId: string,
): StaticClientSecrets {
	return {
		localmanWeb: derivedClientSecret(
			masterKey,
			tenantId,
			STATIC_CLIENT_IDS.localmanWeb,
		),
		tuneloWeb: derivedClientSecret(
			masterKey,
			tenantId,
			STATIC_CLIENT_IDS.tuneloWeb,
		),
		chatWeb: derivedClientSecret(
			masterKey,
			tenantId,
			STATIC_CLIENT_IDS.chatWeb,
		),
		scribeWeb: derivedClientSecret(
			masterKey,
			tenantId,
			STATIC_CLIENT_IDS.scribeWeb,
		),
	};
}
