import * as client from "openid-client";
import { STATIC_CLIENT_IDS, TOKEN_EXCHANGE_GRANT } from "../../oidc/clients.js";
import { ACCESS_TOKEN_TYPE } from "../../oidc/token-exchange-request.js";
import { discoverClient } from "./flows.js";
import { signedInBrowser } from "./session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./test-accounts.js";
import type { TestBrowser } from "./test-browser.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	TUNELO_WEB_SECRET,
	type TestIdp,
} from "./test-idp.js";
import { RESOURCES } from "./test-tenant.js";

export const TUNELO_CALLBACK = "https://tunnel.hoandat.com/auth/callback";

export function localmanWeb(idp: TestIdp): Promise<client.Configuration> {
	return discoverClient(
		idp,
		STATIC_CLIENT_IDS.localmanWeb,
		client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
	);
}

export function tuneloWeb(idp: TestIdp): Promise<client.Configuration> {
	return discoverClient(
		idp,
		STATIC_CLIENT_IDS.tuneloWeb,
		client.ClientSecretBasic(TUNELO_WEB_SECRET),
	);
}

/** Code + PKCE in a browser already signed in to the IdP; returns tokens. */
export async function codeTokens(
	config: client.Configuration,
	browser: TestBrowser,
	redirectUri: string,
	scope: string,
	/** Extra authorization parameters (resource, claims...). */
	extra: Record<string, string> = {},
): Promise<client.TokenEndpointResponse> {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const nonce = client.randomNonce();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		scope,
		state,
		nonce,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...extra,
	});
	const { location } = await browser.navigate(url, {}, redirectUri);
	if (!location) throw new Error("Authorization did not return to the client");
	return client.authorizationCodeGrant(config, location, {
		pkceCodeVerifier: verifier,
		expectedState: state,
		expectedNonce: nonce,
	});
}

/** What Localman holds after sign-in: the (opaque) access token. */
export async function localmanSignIn(
	idp: TestIdp,
	account: TestAccount,
	scope = "openid profile email",
): Promise<{ accessToken: string; browser: TestBrowser }> {
	const browser = await signedInBrowser(idp, account);
	const tokens = await codeTokens(
		await localmanWeb(idp),
		browser,
		LOCALMAN_CALLBACK,
		scope,
	);
	return { accessToken: tokens.access_token, browser };
}

/** A token exchange request; `overrides` replace or drop (undefined) parameters. */
export function exchange(
	config: client.Configuration,
	subjectToken: string,
	overrides: Record<string, string | undefined> = {},
): Promise<client.TokenEndpointResponse> {
	const parameters: Record<string, string | undefined> = {
		subject_token: subjectToken,
		subject_token_type: ACCESS_TOKEN_TYPE,
		resource: RESOURCES.tunnel,
		scope: "tunnels:read",
		...overrides,
	};
	const defined = Object.entries(parameters).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	);
	return client.genericGrantRequest(
		config,
		TOKEN_EXCHANGE_GRANT,
		Object.fromEntries(defined),
	);
}

/** A new account signed in to Localman; `subject` is its access token. */
export async function signInToLocalman(
	idp: TestIdp,
): Promise<{ accountId: string; subject: string }> {
	const account = await createTestAccount(repositoryOf(idp));
	const { accessToken } = await localmanSignIn(idp, account);
	return { accountId: account._id, subject: accessToken };
}

/** What openid-client rejects with for an OAuth error response. */
export function rejectedWith(error: string): { error: string } {
	return { error };
}
