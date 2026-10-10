import * as client from "openid-client";
import { STATIC_CLIENT_IDS } from "../../oidc/clients.js";
import { discoverClient } from "./flows.js";
import type { TestAccount } from "./test-accounts.js";
import { type TestBrowser, formField } from "./test-browser.js";
import type { TestIdp } from "./test-idp.js";
import { linkedGoogleProfile, signInWith } from "./upstream-sign-in.js";

/**
 * A browser signed in to the IdP as `account` (through localman-web), with
 * the Google account linked to it.
 */
export async function signedInBrowser(
	idp: TestIdp,
	account: TestAccount,
): Promise<TestBrowser> {
	const { page, location } = await signInWith(
		idp,
		"google",
		linkedGoogleProfile(account),
	);
	if (!location) throw new Error("sign-in did not return to the client");
	return page.browser;
}

/** Tunelo CLI device login, approved in `browser` (already signed in). */
export async function cliLogin(
	idp: TestIdp,
	browser: TestBrowser,
): Promise<{ config: client.Configuration; refreshToken: string }> {
	const config = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.tuneloCli,
		client.None(),
	);
	const device = await client.initiateDeviceAuthorization(config, {
		scope: "openid offline_access tunnels:open tunnels:read",
	});
	const input = await (await browser.request(device.verification_uri)).text();
	const approval = await browser.navigate(device.verification_uri, {
		form: {
			xsrf: formField(input, "xsrf"),
			user_code: device.user_code,
			confirm: "yes",
		},
	});
	const uid = /\/interaction\/([\w-]+)/.exec(approval.response.url)?.[1] ?? "";
	await browser.navigate(`${idp.issuer}/interaction/${uid}/consent`, {
		form: { csrf: formField(await approval.response.text(), "csrf") },
	});
	const tokens = await client.genericGrantRequest(
		config,
		"urn:ietf:params:oauth:grant-type:device_code",
		{ device_code: device.device_code },
	);
	if (!tokens.refresh_token) throw new Error("no refresh token");
	return { config, refreshToken: tokens.refresh_token };
}

/** Status of GET /account: 200 when signed in, 303 to the login otherwise. */
export async function accountPageStatus(
	idp: TestIdp,
	browser: TestBrowser,
): Promise<number> {
	return (await browser.request(`${idp.issuer}/account`)).status;
}

/** The uid of the (first) IdP session signed in as `accountId`. */
export async function sessionUidOf(
	idp: TestIdp,
	accountId: string,
): Promise<string> {
	const session = await idp.db
		.collection<{ payload: { uid?: string } }>("oidc_session")
		.findOne({ "payload.accountId": accountId });
	const uid = session?.payload.uid;
	if (!uid) throw new Error("no session for this account");
	return uid;
}
