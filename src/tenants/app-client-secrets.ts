import { createHmac } from "node:crypto";
import type { StaticClientSecrets } from "../oidc/clients.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";

/**
 * Client secret of a confidential first-party app (Localman, Tunelo web)
 * in a tenant other than the primary one: HMAC-SHA256 of
 * `<tenantId>:<clientId>` under `APP_CLIENT_SECRET_KEY`, base64url. The app
 * holds the same key and computes the same value for each tenant it serves,
 * so no API ever hands a secret out and owners never see or rotate one.
 * Rotating the key rotates every derived secret at once.
 */
export function derivedClientSecret(
	key: string,
	tenantId: string,
	clientId: string,
): string {
	return createHmac("sha256", key)
		.update(`${tenantId}:${clientId}`, "utf8")
		.digest("base64url");
}

export function derivedClientSecrets(
	key: string,
	tenantId: string,
): StaticClientSecrets {
	return {
		localmanWeb: derivedClientSecret(
			key,
			tenantId,
			STATIC_CLIENT_IDS.localmanWeb,
		),
		tuneloWeb: derivedClientSecret(key, tenantId, STATIC_CLIENT_IDS.tuneloWeb),
	};
}
