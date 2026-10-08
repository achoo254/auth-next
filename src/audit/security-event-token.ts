import { SignJWT, importJWK } from "jose";
import { SIGNING_ALG, type SigningJwks } from "../oidc/jwks.js";
import { auditEventUri } from "./audit-events.js";
import type { AuditOutboxDocument } from "./audit-outbox.js";

/** RFC 8417 media type; receivers check it so a SET is never taken for a token. */
export const SET_TYPE = "secevent+jwt";

/** How long one signed delivery attempt stays acceptable. */
export const SET_LIFETIME_SECONDS = 10 * 60;

export type SecurityEventSigner = (
	event: AuditOutboxDocument,
) => Promise<string>;

function epochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000);
}

/**
 * Signs events as Security Event Tokens (RFC 8417) with the IdP's current
 * signing key, so Localman verifies them against the published JWKS (`kid`
 * in the header). `jti` is the event id, `toe` when it happened, and the
 * single `events` member holds the event's data plus where it came from.
 * `aud` is the exact intake URL; each attempt is signed afresh and expires
 * 10 minutes after signing, so a captured SET cannot be replayed later.
 */
export function createSecurityEventSigner(options: {
	readonly issuer: string;
	/** The intake URL itself, e.g. https://localman.hoandat.com/internal/audit-events. */
	readonly audience: string;
	readonly jwks: SigningJwks;
	readonly now?: () => Date;
}): SecurityEventSigner {
	const signingKey = options.jwks.keys[0];
	if (!signingKey) throw new Error("No signing key to sign audit events with");
	const { kid } = signingKey;
	let key: ReturnType<typeof importJWK> | undefined;
	const now = options.now ?? (() => new Date());
	return async (event) => {
		key ??= importJWK({ ...signingKey }, SIGNING_ALG);
		const signedAt = epochSeconds(now());
		const payload = {
			...event.data,
			...(event.context?.ip ? { ip: event.context.ip } : {}),
			...(event.context?.userAgent
				? { user_agent: event.context.userAgent }
				: {}),
		};
		return new SignJWT({
			toe: epochSeconds(event.occurredAt),
			events: { [auditEventUri(event.type)]: payload },
		})
			.setProtectedHeader({ alg: SIGNING_ALG, kid, typ: SET_TYPE })
			.setIssuer(options.issuer)
			.setAudience(options.audience)
			.setSubject(event.sub)
			.setJti(event._id)
			.setIssuedAt(signedAt)
			.setExpirationTime(signedAt + SET_LIFETIME_SECONDS)
			.sign(await key);
	};
}
