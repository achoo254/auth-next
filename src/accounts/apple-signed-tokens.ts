import { type JWTVerifyGetKey, createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { APPLE_ISSUER } from "./apple-client-secret.js";

export const APPLE_JWKS_URI = `${APPLE_ISSUER}/auth/keys`;

/** Apple's public keys, fetched on demand and cached by jose. */
export function appleKeySet(): JWTVerifyGetKey {
	return createRemoteJWKSet(new URL(APPLE_JWKS_URI));
}

/** Apple sends booleans in its tokens either as JSON booleans or strings. */
const appleBoolean = z
	.union([z.boolean(), z.enum(["true", "false"])])
	.transform((value) => value === true || value === "true");

const idTokenClaims = z.object({
	sub: z.string().min(1).max(255),
	nonce: z.string().optional(),
	email: z.string().max(254).optional(),
	email_verified: appleBoolean.optional(),
	is_private_email: appleBoolean.optional(),
});

export interface AppleIdentity {
	/** Stable per team: the account's Apple id. */
	readonly sub: string;
	/** Set only when Apple marks it verified (a relay address counts). */
	readonly verifiedEmail?: string;
	/** An @privaterelay.appleid.com address the person chose to share. */
	readonly privateEmail: boolean;
}

/**
 * Checks an Apple ID token in full: signature against Apple's published
 * keys, issuer, audience (our Services ID), expiry and our nonce.
 */
export async function verifyAppleIdToken(
	idToken: string,
	expected: {
		readonly keys: JWTVerifyGetKey;
		readonly clientId: string;
		readonly nonce: string;
	},
): Promise<AppleIdentity> {
	const { payload } = await jwtVerify(idToken, expected.keys, {
		issuer: APPLE_ISSUER,
		audience: expected.clientId,
		algorithms: ["RS256"],
		requiredClaims: ["exp", "iat", "sub"],
		clockTolerance: 30,
	});
	const claims = idTokenClaims.parse(payload);
	if (claims.nonce !== expected.nonce) {
		throw new Error("Apple ID token nonce does not match");
	}
	return {
		sub: claims.sub,
		verifiedEmail:
			claims.email_verified === true && claims.email ? claims.email : undefined,
		privateEmail: claims.is_private_email === true,
	};
}

const appleEvent = z.object({
	type: z.string().max(64),
	sub: z.string().min(1).max(255),
});

/** `events` arrives as a JSON string in practice, as an object in Apple's docs. */
const eventsClaim = z.union([
	appleEvent,
	z
		.string()
		.max(4096)
		.transform((value, ctx) => {
			try {
				return JSON.parse(value) as unknown;
			} catch {
				ctx.addIssue({ code: "custom", message: "events is not JSON" });
				return z.NEVER;
			}
		})
		.pipe(appleEvent),
]);

export interface AppleAccountEvent {
	/**
	 * `email-disabled`, `email-enabled`, `consent-revoked`,
	 * `account-deleted`, or a newer type this IdP ignores.
	 */
	readonly type: string;
	readonly sub: string;
}

/**
 * Checks a server-to-server notification (`{ "payload": <JWS> }`) and
 * returns its event: signed by Apple, for one of our client ids.
 */
export async function verifyAppleNotification(
	payloadJwt: string,
	expected: {
		readonly keys: JWTVerifyGetKey;
		readonly audiences: readonly string[];
	},
): Promise<AppleAccountEvent> {
	const { payload } = await jwtVerify(payloadJwt, expected.keys, {
		issuer: APPLE_ISSUER,
		audience: [...expected.audiences],
		algorithms: ["RS256"],
		requiredClaims: ["iat"],
		clockTolerance: 30,
	});
	return eventsClaim.parse(payload.events);
}
