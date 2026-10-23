import type { JWTVerifyGetKey } from "jose";
import * as client from "openid-client";
import { z } from "zod";
import type { AppleSignInConfig } from "../config/apple-env.js";
import type { UpstreamProfile } from "./account-linking.js";
import { APPLE_ISSUER, appleClientSecret } from "./apple-client-secret.js";
import {
	APPLE_JWKS_URI,
	type AppleAccountEvent,
	appleKeySet,
	verifyAppleIdToken,
	verifyAppleNotification,
} from "./apple-signed-tokens.js";
import { callbackUrl } from "./upstream-callback-url.js";
import { type UpstreamClient, isFreshAuthTime } from "./upstream-client.js";

/**
 * Apple's OpenID Provider metadata, pinned like Google's. Values match
 * https://appleid.apple.com/.well-known/openid-configuration. Apple does
 * not support PKCE: state (bound to the browser) and nonce protect the code.
 */
export const APPLE_SERVER: client.ServerMetadata = {
	issuer: APPLE_ISSUER,
	authorization_endpoint: `${APPLE_ISSUER}/auth/authorize`,
	token_endpoint: `${APPLE_ISSUER}/auth/token`,
	revocation_endpoint: `${APPLE_ISSUER}/auth/revoke`,
	jwks_uri: APPLE_JWKS_URI,
	id_token_signing_alg_values_supported: ["RS256"],
};

/** The `user` form field Apple posts on the first authorization only. */
const appleUser = z.object({
	name: z
		.object({
			firstName: z.string().max(100).optional(),
			lastName: z.string().max(100).optional(),
		})
		.optional(),
});

/** The display name Apple shared, if any; it is never sent again. */
export function appleDisplayName(user: string | null): string | undefined {
	if (!user) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(user);
	} catch {
		return undefined;
	}
	const result = appleUser.safeParse(parsed);
	if (!result.success) return undefined;
	const { firstName, lastName } = result.data.name ?? {};
	const name = [firstName, lastName]
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(" ");
	return name.length > 0 ? name.slice(0, 200) : undefined;
}

/** Apple, with what only Apple needs: revocation and account events. */
export interface AppleUpstreamClient extends UpstreamClient {
	readonly provider: "apple";
	verifyNotification(payload: string): Promise<AppleAccountEvent>;
}

export function isAppleUpstream(
	upstream: UpstreamClient | undefined,
): upstream is AppleUpstreamClient {
	return upstream?.provider === "apple" && "verifyNotification" in upstream;
}

/**
 * Sign in with Apple, web flow: Authorization Code with response_mode
 * form_post (Apple's rule when asking for name or email), state and nonce.
 * openid-client redeems the code and checks the ID token's claims; jose
 * then checks its signature against Apple's keys as well.
 */
export function createAppleUpstream(
	config: AppleSignInConfig,
	redirectUri: string,
	keys: JWTVerifyGetKey = appleKeySet(),
): AppleUpstreamClient {
	const configuration = async (): Promise<client.Configuration> =>
		new client.Configuration(
			APPLE_SERVER,
			config.servicesId,
			{ redirect_uris: [redirectUri], response_types: ["code"] },
			client.ClientSecretPost(await appleClientSecret(config)),
		);
	return {
		provider: "apple",
		responseMode: "form_post",
		// Apple has no prompt parameter; a fresh authentication (`freshLogin`)
		// counts only when its ID token's auth_time proves it (fetchProfile).
		async authorizationUrl(checks) {
			return client.buildAuthorizationUrl(await configuration(), {
				redirect_uri: redirectUri,
				response_mode: "form_post",
				scope: "name email",
				state: checks.state,
				nonce: checks.nonce,
			});
		},
		async fetchProfile(query, checks): Promise<UpstreamProfile> {
			const response = new URLSearchParams();
			for (const name of ["state", "code", "error"]) {
				const value = query.get(name);
				if (value !== null) response.set(name, value);
			}
			const tokens = await client.authorizationCodeGrant(
				await configuration(),
				callbackUrl(redirectUri, response),
				{
					expectedState: checks.state,
					expectedNonce: checks.nonce,
					idTokenExpected: true,
				},
			);
			if (!tokens.id_token) throw new Error("Apple sent no ID token");
			const identity = await verifyAppleIdToken(tokens.id_token, {
				keys,
				clientId: config.servicesId,
				nonce: checks.nonce,
			});
			return {
				provider: "apple",
				providerId: identity.sub,
				verifiedEmail: identity.verifiedEmail,
				name: appleDisplayName(query.get("user")),
				revocationToken: tokens.refresh_token,
				...(checks.freshLogin && isFreshAuthTime(tokens.claims()?.auth_time)
					? { freshAuth: true }
					: {}),
			};
		},
		async revoke(token) {
			await client.tokenRevocation(await configuration(), token, {
				token_type_hint: "refresh_token",
			});
		},
		verifyNotification(payload) {
			return verifyAppleNotification(payload, {
				keys,
				audiences: config.notificationAudiences,
			});
		},
	};
}
