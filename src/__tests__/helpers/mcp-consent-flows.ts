import * as client from "openid-client";
import { submitForm } from "./test-accounts.js";
import { type TestBrowser, formField } from "./test-browser.js";
import type { TestIdp } from "./test-idp.js";
import { createAccessTokenVerifier } from "./verify-access-token.js";

/** Loopback redirect of the MCP clients registered by these flows. */
export const MCP_REDIRECT = "http://127.0.0.1:33422/callback";

/** Registers a public MCP client (DCR) on the test IdP. */
export function registerMcpClient(
	idp: TestIdp,
	metadata: Partial<client.ClientMetadata> = {},
): Promise<client.Configuration> {
	return client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [MCP_REDIRECT],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			client_name: "Agent",
			...metadata,
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
}

export interface ConsentResult {
	readonly page: string;
	readonly tokens: client.TokenEndpointResponse;
}

/** Opens the consent page in `browser`, allows it and redeems the code. */
export async function consentAndRedeem(
	idp: TestIdp,
	browser: TestBrowser,
	config: client.Configuration,
	scope: string,
	resource?: string,
): Promise<ConsentResult> {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: MCP_REDIRECT,
		scope,
		...(resource ? { resource } : {}),
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
	});
	const { response } = await browser.navigate(url, {}, MCP_REDIRECT);
	const page = await response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
	if (!uid) throw new Error(`no consent page: ${response.status}`);
	const back = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/consent`,
		{ csrf: formField(page, "csrf") },
		MCP_REDIRECT,
	);
	if (!back.location) throw new Error("did not return to the client");
	const tokens = await client.authorizationCodeGrant(config, back.location, {
		pkceCodeVerifier: verifier,
		expectedState: state,
	});
	return { page, tokens };
}

/** The sorted scopes of an access token, verified for `audience`. */
export async function accessTokenScopes(
	idp: TestIdp,
	audience: string,
	{ tokens }: ConsentResult,
): Promise<string[]> {
	const payload = await createAccessTokenVerifier({
		issuer: idp.issuer,
		audience,
		jwksUri: `${idp.issuer}/jwks`,
	})(tokens.access_token);
	return String(payload.scope).split(" ").sort();
}
