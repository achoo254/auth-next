import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHAT_MOBILE_REDIRECT_URI } from "../oidc/chat-clients.js";
import {
	STATIC_CLIENT_IDS,
	isStaticClientId,
	refreshesPerDevice,
} from "../oidc/clients.js";
import { hasHardCap } from "../oidc/sliding-grants.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import {
	CHAT_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

/**
 * oidc-provider refuses outgoing calls to special-use addresses, so the
 * back-channel logout is checked on the IdP side (which client and session
 * it was delivered, or tried, for), as in tunelo-web-flow.test.ts.
 */
const CHAT_URL = "http://127.0.0.1:9";
const CHAT_SCOPE = "openid profile email";
/** Desktop runs the chat web app as a PWA; this id must stay unregistered. */
const RETIRED_DESKTOP_CLIENT_ID = "chat-desktop";
const backchannel: { clientId: string; sid: unknown }[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { CHAT_WEB_URL: CHAT_URL },
	});
	const record = (...args: unknown[]): void => {
		const target = args.find(
			(arg): arg is { clientId: string } =>
				typeof arg === "object" && arg !== null && "clientId" in arg,
		);
		if (target)
			backchannel.push({ clientId: target.clientId, sid: args.at(-1) });
	};
	idp.provider.on("backchannel.success", record);
	idp.provider.on("backchannel.error", record);
});

afterAll(async () => {
	await idp?.close();
});

async function signedIn(): Promise<TestBrowser> {
	return signedInBrowser(idp, await createTestAccount(repositoryOf(idp)));
}

async function signOutAtIdp(browser: TestBrowser): Promise<void> {
	const ask = await (await browser.request(`${idp.issuer}/session/end`)).text();
	await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
		xsrf: formField(ask, "xsrf"),
		logout: "yes",
	});
}

function nativeClient(clientId: string): Promise<client.Configuration> {
	return discoverClient(idp, clientId, client.None());
}

async function authorizationUrl(
	config: client.Configuration,
	redirectUri: string,
	extra: Record<string, string> = {},
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		scope: CHAT_SCOPE,
		state,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...extra,
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

/**
 * Signs a native chat app in through the system browser: the IdP shows its
 * first-party approval page once, then returns the code to the app.
 */
async function nativeSignIn(
	browser: TestBrowser,
	config: client.Configuration,
	redirectUri: string,
	extra: Record<string, string> = {},
) {
	const { url, checks } = await authorizationUrl(config, redirectUri, extra);
	const { response } = await browser.navigate(url, {}, redirectUri);
	const page = await response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
	if (!uid) throw new Error(`no approval page: ${response.status}`);
	const back = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/consent`,
		{ csrf: formField(page, "csrf") },
		redirectUri,
	);
	if (!back.location) throw new Error("did not return to the app");
	const tokens = await client.authorizationCodeGrant(
		config,
		back.location,
		checks,
	);
	return { page, tokens };
}

describe("chat-web", () => {
	it("signs in without a consent page, with a session-bound refresh token that ends on IdP sign-out, and logs out over the back channel", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.chatWeb,
			client.ClientSecretBasic(CHAT_WEB_SECRET),
		);
		const tokens = await codeTokens(
			config,
			browser,
			`${CHAT_URL}/auth/callback`,
			CHAT_SCOPE,
		);
		// No resource and no API scope: an opaque token, good for userinfo only.
		expect(tokens.access_token.split(".")).toHaveLength(1);
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for chat-web");
		const sid = decodeJwt(tokens.id_token ?? "").sid;
		expect(sid).toEqual(expect.any(String));

		await signOutAtIdp(browser);
		await expect
			.poll(() => backchannel, { timeout: 5000 })
			.toContainEqual({ clientId: STATIC_CLIENT_IDS.chatWeb, sid });
		await expect(
			client.refreshTokenGrant(config, refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("keeps the 90-day cap", () => {
		expect(hasHardCap(STATIC_CLIENT_IDS.chatWeb)).toBe(true);
	});
});

describe("chat-mobile", () => {
	it("chat-mobile: approves on a first-party page and keeps its refresh token after IdP sign-out", async () => {
		const browser = await signedIn();
		const config = await nativeClient(STATIC_CLIENT_IDS.chatMobile);
		const { page, tokens } = await nativeSignIn(
			browser,
			config,
			CHAT_MOBILE_REDIRECT_URI,
		);
		expect(page).toContain('<b data-id="consent-client-name">Chat</b>');
		expect(page).not.toContain('data-id="consent-external');
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for chat-mobile");

		await signOutAtIdp(browser);
		const refreshed = await client.refreshTokenGrant(config, refreshToken);
		expect(refreshed.refresh_token).toEqual(expect.any(String));
		expect(refreshed.refresh_token).not.toBe(refreshToken);
	});

	it("lists each signed-in machine at /account and signs it out alone", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const tablet = await signedInBrowser(idp, account);
		const phone = await signedInBrowser(idp, account);
		const mobile = await nativeClient(STATIC_CLIENT_IDS.chatMobile);
		const onTablet = await nativeSignIn(
			tablet,
			mobile,
			CHAT_MOBILE_REDIRECT_URI,
			{ device_name: "tablet-cua-dat" },
		);
		const onPhone = await nativeSignIn(
			phone,
			mobile,
			CHAT_MOBILE_REDIRECT_URI,
			{ device_name: "phone-cua-dat" },
		);

		const accountPage = await (
			await tablet.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain("Chat · tablet-cua-dat");
		expect(accountPage).toContain("Chat · phone-cua-dat");
		const grantIds = [
			...accountPage.matchAll(/\/account\/devices\/([\w-]+)\/revoke/g),
		].map((match) => match[1]);
		expect(grantIds).toHaveLength(2);
		// The tablet row comes from the tablet's own grant.
		const tabletRow = accountPage
			.split('<li class="item-row"')
			.find((row) => row.includes("tablet-cua-dat"));
		const tabletGrant =
			/\/account\/devices\/([\w-]+)\/revoke/.exec(tabletRow ?? "")?.[1] ?? "";
		await submitForm(
			tablet,
			`${idp.issuer}/account/devices/${tabletGrant}/revoke`,
			{ csrf: formField(accountPage, "csrf") },
		);

		await expect(
			client.refreshTokenGrant(mobile, onTablet.tokens.refresh_token ?? ""),
		).rejects.toMatchObject({ error: "invalid_grant" });
		const refreshed = await client.refreshTokenGrant(
			mobile,
			onPhone.tokens.refresh_token ?? "",
		);
		expect(refreshed.refresh_token).toEqual(expect.any(String));
	});

	it("rejects any other redirect", async () => {
		const browser = await signedIn();
		const cases: [string, string][] = [
			[STATIC_CLIENT_IDS.chatMobile, "com.evil.chat:/auth/callback"],
			[STATIC_CLIENT_IDS.chatMobile, "http://127.0.0.1:53123/auth/callback"],
		];
		for (const [clientId, redirect] of cases) {
			const { url } = await authorizationUrl(
				await nativeClient(clientId),
				redirect,
			);
			const { response, location } = await browser.navigate(url, {}, redirect);
			expect(location, `${clientId} ${redirect}`).toBeUndefined();
			expect(response.status, `${clientId} ${redirect}`).toBe(400);
		}
	});

	it("has no 90-day cap, like Tunelo CLI devices", () => {
		expect(hasHardCap(STATIC_CLIENT_IDS.chatMobile)).toBe(false);
		expect(hasHardCap(STATIC_CLIENT_IDS.tuneloCli)).toBe(false);
	});
});

describe("chat-desktop (retired: desktop is the PWA)", () => {
	it("is not a static client and gets no device-bound refresh", () => {
		expect(Object.values(STATIC_CLIENT_IDS)).not.toContain(
			RETIRED_DESKTOP_CLIENT_ID,
		);
		expect(isStaticClientId(RETIRED_DESKTOP_CLIENT_ID)).toBe(false);
		expect(refreshesPerDevice(RETIRED_DESKTOP_CLIENT_ID)).toBe(false);
	});

	it("is unknown to the provider: no sign-in, no refresh of an old grant", async () => {
		expect(await idp.provider.Client.find(RETIRED_DESKTOP_CLIENT_ID)).toBe(
			undefined,
		);
		const metadata = (
			await nativeClient(STATIC_CLIENT_IDS.chatMobile)
		).serverMetadata();
		const redirect = "http://127.0.0.1:53123/auth/callback";
		const authorize = new URL(metadata.authorization_endpoint ?? "");
		authorize.search = new URLSearchParams({
			client_id: RETIRED_DESKTOP_CLIENT_ID,
			response_type: "code",
			redirect_uri: redirect,
			scope: CHAT_SCOPE,
			code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			code_challenge_method: "S256",
		}).toString();
		const browser = await signedIn();
		const { response, location } = await browser.navigate(
			authorize.href,
			{},
			redirect,
		);
		expect(location).toBeUndefined();
		expect(response.status).toBe(400);

		// A refresh token kept from a never-shipped desktop build cannot be
		// redeemed: client authentication fails before the token is looked up.
		const refresh = await fetch(metadata.token_endpoint ?? "", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: "stale-desktop-refresh-token",
				client_id: RETIRED_DESKTOP_CLIENT_ID,
			}),
		});
		expect(refresh.status).toBe(401);
		expect(await refresh.json()).toMatchObject({ error: "invalid_client" });
	});
});
