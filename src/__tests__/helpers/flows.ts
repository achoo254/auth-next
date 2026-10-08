import * as client from "openid-client";
import { DEVICE_CODE_GRANT } from "../../oidc/clients.js";
import { TestBrowser, formField } from "./test-browser.js";
import type { TestIdp } from "./test-idp.js";

/** openid-client configuration for a client of the test IdP (http issuer). */
export function discoverClient(
	idp: TestIdp,
	clientId: string,
	auth: client.ClientAuth,
	metadata: Partial<client.ClientMetadata> = {},
): Promise<client.Configuration> {
	return client.discovery(new URL(idp.issuer), clientId, metadata, auth, {
		execute: [client.allowInsecureRequests],
	});
}

export interface CodeFlowResult {
	readonly tokens: client.TokenEndpointResponse &
		client.TokenEndpointResponseHelpers;
	/** Sent only for OpenID requests; plain OAuth (MCP) requests have none. */
	readonly nonce?: string;
}

/** A code returned to the client plus the checks needed to redeem it. */
export interface AuthorizedCode {
	readonly location: URL;
	readonly checks: client.AuthorizationCodeGrantChecks;
	/** Sent only for OpenID requests; plain OAuth (MCP) requests have none. */
	readonly nonce?: string;
}

/** Authorization Code + PKCE through the browser endpoints, up to the code. */
export async function authorizeForCode(
	config: client.Configuration,
	redirectUri: string,
	parameters: Record<string, string>,
): Promise<AuthorizedCode> {
	const verifier = client.randomPKCECodeVerifier();
	const isOpenId = parameters.scope?.split(" ").includes("openid") === true;
	const nonce = isOpenId ? client.randomNonce() : undefined;
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
		...(nonce ? { nonce } : {}),
		...parameters,
	});
	const { location } = await new TestBrowser().navigate(url, {}, redirectUri);
	if (!location) throw new Error("Authorization did not return to the client");
	return {
		location,
		nonce,
		checks: {
			pkceCodeVerifier: verifier,
			expectedNonce: nonce,
			expectedState: state,
		},
	};
}

/**
 * Full code flow: the exchange runs nonce, state and PKCE checks in
 * openid-client.
 */
export async function runCodeFlow(
	config: client.Configuration,
	redirectUri: string,
	parameters: Record<string, string>,
): Promise<CodeFlowResult> {
	const { location, checks, nonce } = await authorizeForCode(
		config,
		redirectUri,
		parameters,
	);
	const tokens = await client.authorizationCodeGrant(config, location, checks);
	return { tokens, nonce };
}

/** Follows an authorization request and returns where it sent the browser. */
export async function authorizationRedirect(
	config: client.Configuration,
	redirectUri: string,
	parameters: Record<string, string>,
): Promise<URL> {
	const verifier = client.randomPKCECodeVerifier();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...parameters,
	});
	const { location } = await new TestBrowser().navigate(url, {}, redirectUri);
	if (!location) throw new Error("Authorization did not return to the client");
	return location;
}

/** Polls the token endpoint once for a device code. */
export function pollDeviceCode(
	config: client.Configuration,
	deviceCode: string,
): Promise<client.TokenEndpointResponse> {
	return client.genericGrantRequest(config, DEVICE_CODE_GRANT, {
		device_code: deviceCode,
	});
}

/**
 * Plays the user on the verification page: opens it, submits the user code
 * with confirmation and follows the interaction redirects to the end page.
 */
export async function approveDevice(
	verificationUri: string,
	userCode: string,
): Promise<Response> {
	const browser = new TestBrowser();
	const page = await browser.request(verificationUri);
	const xsrf = formField(await page.text(), "xsrf");
	const { response } = await browser.navigate(verificationUri, {
		form: { xsrf, user_code: userCode, confirm: "yes" },
	});
	return response;
}

/** Device flow from request to tokens, approved by the test user. */
export async function deviceLogin(
	config: client.Configuration,
	scope: string,
): Promise<client.TokenEndpointResponse> {
	const authorization = await client.initiateDeviceAuthorization(config, {
		scope,
	});
	const page = await approveDevice(
		authorization.verification_uri,
		authorization.user_code,
	);
	if (page.status !== 200) {
		throw new Error(`Device approval ended with HTTP ${page.status}`);
	}
	return pollDeviceCode(config, authorization.device_code);
}
