import { SignJWT } from "jose";
import type { AppleSignInConfig } from "../config/apple-env.js";

export const APPLE_ISSUER = "https://appleid.apple.com";

/** Apple accepts up to six months; a short life limits a leaked secret. */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

/**
 * Apple's `client_secret`: a JWT signed ES256 with the Sign in with Apple
 * key, issued by the team for the Services ID. Made fresh for every token
 * or revocation request, so none is ever stored.
 */
export function appleClientSecret(
	config: Pick<
		AppleSignInConfig,
		"teamId" | "servicesId" | "keyId" | "privateKey"
	>,
	now: Date = new Date(),
): Promise<string> {
	const issuedAt = Math.floor(now.getTime() / 1000);
	return new SignJWT({})
		.setProtectedHeader({ alg: "ES256", kid: config.keyId })
		.setIssuer(config.teamId)
		.setSubject(config.servicesId)
		.setAudience(APPLE_ISSUER)
		.setIssuedAt(issuedAt)
		.setExpirationTime(issuedAt + CLIENT_SECRET_TTL_SECONDS)
		.sign(config.privateKey);
}
