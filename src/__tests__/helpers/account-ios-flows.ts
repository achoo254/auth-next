import { SignJWT, importJWK } from "jose";
import * as client from "openid-client";
import {
	ACCOUNT_IOS_CLIENT_ID,
	IOS_CALLBACK_PATH,
} from "../../oidc/account-ios-client.js";
import { primarySigningKey } from "../../oidc/jwks.js";
import { discoverClient } from "./flows.js";
import { signedInBrowser } from "./session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./test-accounts.js";
import { type TestBrowser, formField } from "./test-browser.js";
import type { TestIdp } from "./test-idp.js";
import { linkedGoogleProfile } from "./upstream-sign-in.js";

export const ACCOUNT_IOS_SCOPE = "openid profile email account";

export function iosCallbackOf(idp: TestIdp): string {
	return `${idp.issuer}${IOS_CALLBACK_PATH}`;
}

export function accountIosConfig(idp: TestIdp): Promise<client.Configuration> {
	return discoverClient(idp, ACCOUNT_IOS_CLIENT_ID, client.None());
}

/** Follows a native-app authorization, approving on the consent page. */
async function approveToCallback(
	idp: TestIdp,
	browser: TestBrowser,
	start: { response: Response; location?: URL },
): Promise<URL> {
	if (start.location) return start.location;
	const page = await start.response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(start.response.url)?.[1];
	if (!uid) throw new Error(`no approval page: ${start.response.status}`);
	const back = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/consent`,
		{ csrf: formField(page, "csrf") },
		iosCallbackOf(idp),
	);
	if (!back.location) throw new Error("did not return to the app");
	return back.location;
}

export type AppTokens = client.TokenEndpointResponse &
	client.TokenEndpointResponseHelpers;

/**
 * The app's sign-in in `browser` (signed in to the IdP already): Code +
 * PKCE, consent, code redeemed. With `reauthenticate` as `account`, the
 * request has prompt=login and the browser signs in with Google again.
 */
export async function appSignIn(
	idp: TestIdp,
	browser: TestBrowser,
	reauthenticate?: TestAccount,
): Promise<AppTokens> {
	const config = await accountIosConfig(idp);
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const nonce = client.randomNonce();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: iosCallbackOf(idp),
		scope: ACCOUNT_IOS_SCOPE,
		state,
		nonce,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...(reauthenticate ? { prompt: "login" } : {}),
	});
	let start = await browser.navigate(url, {}, iosCallbackOf(idp));
	if (reauthenticate) {
		const uid = /\/interaction\/([\w-]+)/.exec(start.response.url)?.[1];
		if (!uid) throw new Error("no login page for prompt=login");
		idp.fake.nextLogins.push(linkedGoogleProfile(reauthenticate));
		start = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
			{},
			iosCallbackOf(idp),
		);
	}
	const location = await approveToCallback(idp, browser, start);
	return client.authorizationCodeGrant(config, location, {
		pkceCodeVerifier: verifier,
		expectedState: state,
		expectedNonce: nonce,
	});
}

export interface SignedInApp {
	readonly account: TestAccount;
	readonly browser: TestBrowser;
	readonly tokens: AppTokens;
	readonly accessToken: string;
}

/** A new account (Google linked, optionally more) signed in to the app. */
export async function signedInApp(
	idp: TestIdp,
	providers?: TestAccount["providers"],
): Promise<SignedInApp> {
	const account = await createTestAccount(
		repositoryOf(idp),
		providers ? { providers } : {},
	);
	const browser = await signedInBrowser(idp, account);
	const tokens = await appSignIn(idp, browser);
	return { account, browser, tokens, accessToken: tokens.access_token };
}

/** Calls /api/account with a bearer token and an optional JSON body. */
export function callApi(
	idp: TestIdp,
	path: string,
	options: {
		readonly token?: string;
		readonly method?: string;
		readonly body?: unknown;
	} = {},
): Promise<Response> {
	const headers = new Headers();
	if (options.token) headers.set("authorization", `Bearer ${options.token}`);
	if (options.body !== undefined)
		headers.set("content-type", "application/json");
	return fetch(`${idp.issuer}/api/account${path}`, {
		method: options.method ?? "GET",
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
}

/**
 * An ID token signed with the IdP's own key, with `claims` over sane
 * defaults: proves what recent-auth checks without a browser round trip.
 */
export async function forgeIdToken(
	idp: TestIdp,
	claims: Record<string, unknown>,
): Promise<string> {
	const key = primarySigningKey(idp.jwks);
	const now = Math.floor(Date.now() / 1000);
	return new SignJWT({
		iss: idp.issuer,
		aud: ACCOUNT_IOS_CLIENT_ID,
		iat: now,
		exp: now + 600,
		auth_time: now,
		...claims,
	})
		.setProtectedHeader({ alg: "ES256", kid: key.kid })
		.sign(await importJWK(key, "ES256"));
}
