import * as client from "openid-client";
import { z } from "zod";
import type { OAuthAppCredentials } from "../config/integrations-env.js";
import type { UpstreamProfile } from "./account-linking.js";
import { callbackUrl } from "./upstream-callback-url.js";
import type { UpstreamClient } from "./upstream-client.js";

/** GitHub is plain OAuth 2.0 (no discovery, no ID token): endpoints by hand. */
export const GITHUB_SERVER: client.ServerMetadata = {
	issuer: "https://github.com/login/oauth",
	authorization_endpoint: "https://github.com/login/oauth/authorize",
	token_endpoint: "https://github.com/login/oauth/access_token",
	code_challenge_methods_supported: ["S256"],
};

const GITHUB_API = "https://api.github.com";

const githubUser = z.object({
	id: z.number().int().positive(),
	login: z.string(),
	name: z.string().max(200).nullable().optional(),
	avatar_url: z.url().max(2048).nullable().optional(),
});

const githubEmails = z.array(
	z.object({
		email: z.string(),
		primary: z.boolean(),
		verified: z.boolean(),
	}),
);

/** The primary email if GitHub verified it, else any verified one. */
function pickVerifiedEmail(
	emails: z.infer<typeof githubEmails>,
): string | undefined {
	const verified = emails.filter((entry) => entry.verified);
	return (verified.find((entry) => entry.primary) ?? verified[0])?.email;
}

/**
 * GitHub sign-in with openid-client: Authorization Code + PKCE and state.
 * The email comes from /user/emails because /user only shows a public
 * email, verified or not.
 */
export function createGithubUpstream(
	credentials: OAuthAppCredentials,
	redirectUri: string,
): UpstreamClient {
	const config = new client.Configuration(
		GITHUB_SERVER,
		credentials.clientId,
		{ redirect_uris: [redirectUri], response_types: ["code"] },
		client.ClientSecretPost(credentials.clientSecret),
	);

	const githubGet = async (
		path: string,
		accessToken: string,
	): Promise<unknown> => {
		const response = await client.fetchProtectedResource(
			config,
			accessToken,
			new URL(`${GITHUB_API}${path}`),
			"GET",
			null,
			new Headers({
				accept: "application/vnd.github+json",
				"user-agent": "hoandat-auth",
				"x-github-api-version": "2022-11-28",
			}),
		);
		if (!response.ok) {
			throw new Error(`GitHub API ${path} answered HTTP ${response.status}`);
		}
		return response.json();
	};

	return {
		provider: "github",
		responseMode: "query",
		async authorizationUrl(checks) {
			return client.buildAuthorizationUrl(config, {
				redirect_uri: redirectUri,
				scope: "read:user user:email",
				state: checks.state,
				code_challenge: await client.calculatePKCECodeChallenge(
					checks.codeVerifier,
				),
				code_challenge_method: "S256",
			});
		},
		async fetchProfile(query, checks): Promise<UpstreamProfile> {
			const tokens = await client.authorizationCodeGrant(
				config,
				callbackUrl(redirectUri, query),
				{ pkceCodeVerifier: checks.codeVerifier, expectedState: checks.state },
			);
			const [user, emails] = await Promise.all([
				githubGet("/user", tokens.access_token).then((body) =>
					githubUser.parse(body),
				),
				githubGet("/user/emails", tokens.access_token).then((body) =>
					githubEmails.parse(body),
				),
			]);
			return {
				provider: "github",
				providerId: String(user.id),
				verifiedEmail: pickVerifiedEmail(emails),
				login: user.login,
				name: user.name ?? user.login,
				picture: user.avatar_url ?? undefined,
			};
		},
	};
}
