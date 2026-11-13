import { randomUUID } from "node:crypto";
import { SignJWT, importJWK } from "jose";
import {
	SIGNING_ALG,
	type SigningJwks,
	primarySigningKey,
} from "../oidc/jwks.js";

/** The `client_id` and scope Chat requires on a notice token (ADR 0017). */
export const CHAT_NOTICE_CLIENT_ID = "auth-account-notices";
export const CHAT_NOTICE_SCOPE = "account-notices";

/** A notice token is good for one delivery attempt. */
const TOKEN_LIFETIME_SECONDS = 60;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ChatNoticeSender {
	/** Resolves once Chat accepted it (204), else rejects; never logs `text`. */
	send(sub: string, text: string): Promise<void>;
}

/**
 * Sends security notices to Chat, which relays them from its assistant bot
 * to the user with this `sub`. Each request carries a 60-second access
 * token the IdP signs for itself (typ at+jwt, aud the exact endpoint), so
 * Chat checks it like any other IdP token and no secret is shared.
 */
export function createChatNoticeSender(options: {
	readonly endpoint: string;
	readonly issuer: string;
	readonly jwks: SigningJwks;
	readonly fetch?: typeof fetch;
}): ChatNoticeSender {
	const signingKey = primarySigningKey(options.jwks);
	const { kid } = signingKey;
	let key: ReturnType<typeof importJWK> | undefined;
	const send = options.fetch ?? fetch;
	return {
		async send(sub, text) {
			key ??= importJWK({ ...signingKey }, SIGNING_ALG);
			const token = await new SignJWT({
				client_id: CHAT_NOTICE_CLIENT_ID,
				scope: CHAT_NOTICE_SCOPE,
			})
				.setProtectedHeader({ alg: SIGNING_ALG, kid, typ: "at+jwt" })
				.setIssuer(options.issuer)
				.setAudience(options.endpoint)
				.setSubject(sub)
				.setIssuedAt()
				.setExpirationTime(`${TOKEN_LIFETIME_SECONDS}s`)
				.setJti(randomUUID())
				.sign(await key);
			const response = await send(options.endpoint, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ text }),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			// The body is never read: it could only echo what was sent.
			await response.body?.cancel();
			if (response.status !== 204) {
				throw new Error(`Chat answered ${response.status}`);
			}
		},
	};
}
