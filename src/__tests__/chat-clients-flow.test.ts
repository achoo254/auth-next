import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	CHAT_DESKTOP_REDIRECT_URI,
	CHAT_MOBILE_REDIRECT_URI,
} from "../oidc/chat-clients.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
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
/** A port the desktop app picked; only the portless URI is registered. */
const DESKTOP_REDIRECT = "http://127.0.0.1:53123/auth/callback";
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
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		scope: CHAT_SCOPE,
		state,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
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
) {
	const { url, checks } = await authorizationUrl(config, redirectUri);
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

describe("chat-mobile and chat-desktop", () => {
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

	it("chat-desktop: accepts its loopback redirect on any port", async () => {
		const browser = await signedIn();
		const config = await nativeClient(STATIC_CLIENT_IDS.chatDesktop);
		const { tokens } = await nativeSignIn(browser, config, DESKTOP_REDIRECT);
		expect(tokens.refresh_token).toEqual(expect.any(String));
		expect(CHAT_DESKTOP_REDIRECT_URI).toBe("http://127.0.0.1/auth/callback");
	});

	it("rejects any other redirect", async () => {
		const browser = await signedIn();
		const cases: [string, string][] = [
			[STATIC_CLIENT_IDS.chatMobile, "com.evil.chat:/auth/callback"],
			[STATIC_CLIENT_IDS.chatDesktop, "http://localhost:53123/auth/callback"],
			[STATIC_CLIENT_IDS.chatDesktop, "https://127.0.0.1:53123/auth/callback"],
			[STATIC_CLIENT_IDS.chatDesktop, "http://127.0.0.1:53123/other"],
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
		expect(hasHardCap(STATIC_CLIENT_IDS.chatDesktop)).toBe(false);
		expect(hasHardCap(STATIC_CLIENT_IDS.tuneloCli)).toBe(false);
	});
});
