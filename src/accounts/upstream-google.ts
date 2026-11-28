import * as client from "openid-client";
import { z } from "zod";
import type { OAuthAppCredentials } from "../config/integrations-env.js";
import type { UpstreamProfile } from "./account-linking.js";
import { callbackUrl } from "./upstream-callback-url.js";
import type { UpstreamClient } from "./upstream-client.js";

/**
 * Google's OpenID Provider metadata, pinned rather than discovered so that
 * starting a sign-in never waits on a discovery request. Values match
 * https://accounts.google.com/.well-known/openid-configuration.
 */
export const GOOGLE_SERVER: client.ServerMetadata = {
	issuer: "https://accounts.google.com",
	authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
	token_endpoint: "https://oauth2.googleapis.com/token",
	jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
	id_token_signing_alg_values_supported: ["RS256"],
	code_challenge_methods_supported: ["S256"],
};

const googleClaims = z.object({
	sub: z.string().min(1).max(255),
	email: z.string().optional(),
	email_verified: z.boolean().optional(),
	name: z.string().max(200).optional(),
	picture: z.url().max(2048).optional(),
});

/**
 * Google sign-in with openid-client: Authorization Code + PKCE, state and
 * nonce. openid-client validates the ID token's issuer, audience, expiry and
 * nonce; it came straight from Google's token endpoint over TLS, so (OIDC
 * Core 3.1.3.7) its signature is not checked.
 */
export function createGoogleUpstream(
	credentials: OAuthAppCredentials,
	redirectUri: string,
): UpstreamClient {
	const config = new client.Configuration(
		GOOGLE_SERVER,
		credentials.clientId,
		{ redirect_uris: [redirectUri], response_types: ["code"] },
		client.ClientSecretPost(credentials.clientSecret),
	);
	return {
		provider: "google",
		responseMode: "query",
		async authorizationUrl(checks) {
			return client.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				scope: "openid email profile",
				state: checks.state,
				nonce: checks.nonce,
				code_challenge: await client.calculatePKCECodeChallenge(
					checks.codeVerifier,
				),
				code_challenge_method: "S256",
				prompt: "select_account",
			});
		},
		async fetchProfile(query, checks): Promise<UpstreamProfile> {
			const tokens = await client.authorizationCodeGrant(
				config,
				callbackUrl(redirectUri, query),
				{
					pkceCodeVerifier: checks.codeVerifier,
					expectedState: checks.state,
					expectedNonce: checks.nonce,
					idTokenExpected: true,
				},
			);
			const claims = googleClaims.parse(tokens.claims());
			return {
				provider: "google",
				providerId: claims.sub,
				verifiedEmail:
					claims.email_verified === true ? claims.email : undefined,
				name: claims.name,
				picture: claims.picture,
			};
		},
	};
}
