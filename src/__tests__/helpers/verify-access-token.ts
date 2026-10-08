import { type JWTPayload, createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessTokenVerifierOptions {
	/** Exactly the IdP issuer, e.g. https://auth.hoandat.com. */
	readonly issuer: string;
	/** The app's own resource indicator, e.g. https://tunnel.hoandat.com. */
	readonly audience: string;
	/** jwks_uri from the IdP discovery document. */
	readonly jwksUri: string;
}

/**
 * Reference verifier for apps that accept IdP access tokens: offline ES256
 * check against the cached remote JWKS, exact issuer, the app's own audience
 * and the RFC 9068 `at+jwt` type (so an ID token is never accepted).
 */
export function createAccessTokenVerifier(
	options: AccessTokenVerifierOptions,
): (token: string) => Promise<JWTPayload> {
	const jwks = createRemoteJWKSet(new URL(options.jwksUri));
	return async (token) => {
		const { payload } = await jwtVerify(token, jwks, {
			issuer: options.issuer,
			audience: options.audience,
			algorithms: ["ES256"],
			typ: "at+jwt",
		});
		return payload;
	};
}
