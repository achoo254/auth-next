import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import {
	SCRIBE_MOBILE_REDIRECT_URI,
	buildScribeClients,
} from "../oidc/scribe-clients.js";
import { hasHardCap } from "../oidc/sliding-grants.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
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
	SCRIBE_WEB_DEV_SECRET,
	SCRIBE_WEB_DEV_URL,
	SCRIBE_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

/**
 * oidc-provider refuses outgoing calls to special-use addresses, so the
 * back-channel logout is checked on the IdP side (which client and session
 * it was delivered, or tried, for), as in chat-clients-flow.test.ts.
 */
const SCRIBE_URL = "http://127.0.0.1:9";
const SCRIBE_SCOPE = "openid profile email";
const backchannel: { clientId: string; sid: unknown }[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { SCRIBE_WEB_URL: SCRIBE_URL },
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

async function authorizationUrl(
	config: client.Configuration,
	redirectUri: string,
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		scope: SCRIBE_SCOPE,
		state,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

/** Status and redirect of an authorization request for `redirectUri`. */
async function authorize(
	browser: TestBrowser,
	config: client.Configuration,
	redirectUri: string,
) {
	const { url } = await authorizationUrl(config, redirectUri);
	const { response, location } = await browser.navigate(url, {}, redirectUri);
	return { status: response.status, location };
}

describe("scribe-web", () => {
	it("signs in without a consent page, with a session-bound refresh token that ends on IdP sign-out, and logs out over the back channel", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeWeb,
			client.ClientSecretBasic(SCRIBE_WEB_SECRET),
		);
		const tokens = await codeTokens(
			config,
			browser,
			`${SCRIBE_URL}/api/auth/callback`,
			SCRIBE_SCOPE,
		);
		// No resource and no API scope: an opaque token, good for userinfo only.
		expect(tokens.access_token.split(".")).toHaveLength(1);
		const claims = decodeJwt(tokens.id_token ?? "");
		const sub = String(claims.sub);
		const profile = await client.fetchUserInfo(
			config,
			tokens.access_token,
			sub,
		);
		expect(profile.email).toEqual(expect.any(String));
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for scribe-web");

		await signOutAtIdp(browser);
		await expect
			.poll(() => backchannel, { timeout: 5000 })
			.toContainEqual({
				clientId: STATIC_CLIENT_IDS.scribeWeb,
				sid: claims.sid,
			});
		await expect(
			client.refreshTokenGrant(config, refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("needs PKCE and its secret, and keeps the 90-day cap", async () => {
		const browser = await signedIn();
		const redirect = `${SCRIBE_URL}/api/auth/callback`;
		const url = new URL(`${idp.issuer}/auth`);
		url.search = new URLSearchParams({
			client_id: STATIC_CLIENT_IDS.scribeWeb,
			response_type: "code",
			scope: "openid",
			redirect_uri: redirect,
		}).toString();
		const { location } = await browser.navigate(url, {}, redirect);
		// The error goes back to Scribe's own redirect, never elsewhere.
		expect(location?.href.startsWith(redirect)).toBe(true);
		expect(location?.searchParams.get("error")).toBe("invalid_request");
		expect(location?.searchParams.get("error_description")).toMatch(/PKCE/);

		const wrong = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeWeb,
			client.ClientSecretBasic("w".repeat(43)),
		);
		await expect(
			codeTokens(wrong, browser, redirect, SCRIBE_SCOPE),
		).rejects.toMatchObject({ status: 401 });
		expect(hasHardCap(STATIC_CLIENT_IDS.scribeWeb)).toBe(true);
	});
});

describe("scribe-mobile", () => {
	it("approves on a first-party page and keeps its refresh token after IdP sign-out", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeMobile,
			client.None(),
		);
		const { url, checks } = await authorizationUrl(
			config,
			SCRIBE_MOBILE_REDIRECT_URI,
		);
		const { response } = await browser.navigate(
			url,
			{},
			SCRIBE_MOBILE_REDIRECT_URI,
		);
		const page = await response.text();
		expect(page).toContain('<b data-id="consent-client-name">Scribe</b>');
		expect(page).not.toContain('data-id="consent-external');
		const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
		if (!uid) throw new Error(`no approval page: ${response.status}`);
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/consent`,
			{ csrf: formField(page, "csrf") },
			SCRIBE_MOBILE_REDIRECT_URI,
		);
		if (!back.location) throw new Error("did not return to the app");
		const tokens = await client.authorizationCodeGrant(
			config,
			back.location,
			checks,
		);
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for scribe-mobile");

		await signOutAtIdp(browser);
		const refreshed = await client.refreshTokenGrant(config, refreshToken);
		expect(refreshed.refresh_token).toEqual(expect.any(String));
		expect(refreshed.refresh_token).not.toBe(refreshToken);
		expect(hasHardCap(STATIC_CLIENT_IDS.scribeMobile)).toBe(false);
	});

	it("rejects any other redirect", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeMobile,
			client.None(),
		);
		for (const redirect of [
			"com.evil.scribe:/auth/callback",
			"com.hoandat.chat:/auth/callback",
			"http://127.0.0.1:53123/auth/callback",
		]) {
			const { status, location } = await authorize(browser, config, redirect);
			expect(location, redirect).toBeUndefined();
			expect(status, redirect).toBe(400);
		}
	});
});

describe("scribe-web-dev (local development)", () => {
	it("accepts its exact loopback redirect for a confidential web client", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeWebDev,
			client.ClientSecretBasic(SCRIBE_WEB_DEV_SECRET),
		);
		const tokens = await codeTokens(
			config,
			browser,
			`${SCRIBE_WEB_DEV_URL}/api/auth/callback`,
			SCRIBE_SCOPE,
		);
		expect(tokens.refresh_token).toEqual(expect.any(String));
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.scribeWebDev)
		)?.metadata();
		expect(metadata?.backchannel_logout_uri).toBeUndefined();
	});

	it("matches the port exactly: a web client gets no loopback port leeway", async () => {
		const browser = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.scribeWebDev,
			client.ClientSecretBasic(SCRIBE_WEB_DEV_SECRET),
		);
		for (const redirect of [
			"http://localhost:5175/api/auth/callback",
			"http://127.0.0.1:5174/api/auth/callback",
			"http://localhost/api/auth/callback",
		]) {
			const { status, location } = await authorize(browser, config, redirect);
			expect(location, redirect).toBeUndefined();
			expect(status, redirect).toBe(400);
		}
	});
});

describe("other tenants", () => {
	it("have no Scribe client even with the same environment", async () => {
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			for (const id of [
				STATIC_CLIENT_IDS.scribeWeb,
				STATIC_CLIENT_IDS.scribeMobile,
				STATIC_CLIENT_IDS.scribeWebDev,
			]) {
				expect(await other.provider.Client.find(id), id).toBeUndefined();
			}
			expect(
				await other.provider.Client.find(STATIC_CLIENT_IDS.chatWeb),
			).toBeDefined();
		} finally {
			await other.close();
		}
	});
});

describe("buildScribeClients", () => {
	const dev = { url: "http://localhost:5174", secret: "d".repeat(32) };
	const ids = (clients: { client_id: string }[]) =>
		clients.map((c) => c.client_id).sort();

	it("with only the development client, also registers the app (not the site)", () => {
		const clients = buildScribeClients(
			{ id: PRIMARY_TENANT_ID },
			{ mobileRedirectUri: SCRIBE_MOBILE_REDIRECT_URI, dev },
		);
		expect(ids(clients)).toEqual(["scribe-mobile", "scribe-web-dev"]);
	});

	it("registers nothing without a web or development client", () => {
		expect(
			buildScribeClients(
				{ id: PRIMARY_TENANT_ID },
				{ mobileRedirectUri: SCRIBE_MOBILE_REDIRECT_URI },
			),
		).toEqual([]);
	});
});
