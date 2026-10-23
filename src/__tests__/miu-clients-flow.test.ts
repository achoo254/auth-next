import { decodeJwt, decodeProtectedHeader } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import {
	MIU_MOBILE_REDIRECT_URI,
	buildMiuClients,
} from "../oidc/miu-clients.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import {
	MIU_WEB_DEV_SECRET,
	MIU_WEB_DEV_URL,
	MIU_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";
import { linkedGoogleProfile } from "./helpers/upstream-sign-in.js";

/**
 * Miu World signs parents in with `openid email` only and keeps its own
 * sessions: no refresh token. oidc-provider refuses outgoing calls to
 * special-use addresses, so the back-channel logout is checked on the IdP
 * side, as in scribe-clients-flow.test.ts.
 */
const MIU_URL = "http://127.0.0.1:9";
const MIU_CALLBACK = `${MIU_URL}/api/auth/callback`;
const MIU_SCOPE = "openid email";
const backchannel: { clientId: string; sid: unknown }[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { MIU_WEB_URL: MIU_URL },
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

/** A parent whose email Google verified, signed in at the IdP. */
async function signedIn(): Promise<{
	account: TestAccount;
	browser: TestBrowser;
}> {
	const account = await createTestAccount(repositoryOf(idp), {
		emailVerifiedBy: "google",
	});
	return { account, browser: await signedInBrowser(idp, account) };
}

const miuWeb = () =>
	discoverClient(
		idp,
		STATIC_CLIENT_IDS.miuWeb,
		client.ClientSecretBasic(MIU_WEB_SECRET),
	);

async function signOutAtIdp(browser: TestBrowser): Promise<void> {
	const ask = await (await browser.request(`${idp.issuer}/session/end`)).text();
	await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
		xsrf: formField(ask, "xsrf"),
		logout: "yes",
	});
}

describe("miu-web", () => {
	it("signs in without a consent page: verified email and sid in an ES256 ID token, no refresh token, back-channel logout", async () => {
		const { account, browser } = await signedIn();
		const config = await miuWeb();
		const tokens = await codeTokens(config, browser, MIU_CALLBACK, MIU_SCOPE);
		expect(tokens.refresh_token).toBeUndefined();
		expect(tokens.access_token.split(".")).toHaveLength(1);
		const idToken = tokens.id_token ?? "";
		expect(decodeProtectedHeader(idToken).alg).toBe("ES256");
		const claims = decodeJwt(idToken);
		expect(claims).toMatchObject({
			iss: idp.issuer,
			aud: STATIC_CLIENT_IDS.miuWeb,
		});
		expect(claims.sid).toEqual(expect.any(String));
		// How the parent signed in: through Google, not a fresh re-authentication.
		expect(claims.amr).toEqual(["fed", "google"]);
		// auth_time comes only with max_age (see the re-authentication test).
		expect(claims.auth_time).toBeUndefined();
		// Scope claims stay out of the ID token (conformIdTokenClaims):
		// Miu reads the verified email from userinfo, for the same `sub`.
		expect(claims.email).toBeUndefined();
		const profile = await client.fetchUserInfo(
			config,
			tokens.access_token,
			String(claims.sub),
		);
		expect(profile).toMatchObject({
			email: account.email,
			email_verified: true,
			// Miu matches it against its former direct Google sign-in.
			google_sub: account.providers.google,
		});
		expect(claims.google_sub).toBeUndefined();
		// `openid email` only: nothing of the profile scope.
		expect(profile.name).toBeUndefined();
		expect(profile.preferred_username).toBeUndefined();

		await signOutAtIdp(browser);
		await expect
			.poll(() => backchannel, { timeout: 5000 })
			.toContainEqual({ clientId: STATIC_CLIENT_IDS.miuWeb, sid: claims.sid });
	});

	it("refuses a request for more than openid email", async () => {
		const { browser } = await signedIn();
		await expect(
			codeTokens(await miuWeb(), browser, MIU_CALLBACK, "openid email profile"),
		).rejects.toMatchObject({ error: "invalid_scope" });
	});

	it("asks for a fresh sign-in on prompt=login with max_age=0", async () => {
		const { account, browser } = await signedIn();
		const config = await miuWeb();
		const verifier = client.randomPKCECodeVerifier();
		const state = client.randomState();
		const nonce = client.randomNonce();
		const before = Math.floor(Date.now() / 1000);
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: MIU_CALLBACK,
			scope: MIU_SCOPE,
			state,
			nonce,
			prompt: "login",
			max_age: "0",
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: "S256",
		});
		const { response, location } = await browser.navigate(
			url,
			{},
			MIU_CALLBACK,
		);
		// Signed in already, yet the IdP shows its sign-in page again.
		expect(location).toBeUndefined();
		const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
		if (!uid) throw new Error(`no sign-in page: ${response.status}`);
		idp.fake.nextLogins.push(linkedGoogleProfile(account));
		const back = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
			{},
			MIU_CALLBACK,
		);
		if (!back.location) throw new Error("did not return to Miu");
		const tokens = await client.authorizationCodeGrant(config, back.location, {
			pkceCodeVerifier: verifier,
			expectedState: state,
			expectedNonce: nonce,
			maxAge: 0,
		});
		const authTime = decodeJwt(tokens.id_token ?? "").auth_time;
		expect(authTime).toBeGreaterThanOrEqual(before);
	});

	it("needs PKCE and its secret, and has no refresh grant", async () => {
		const { browser } = await signedIn();
		const url = new URL(`${idp.issuer}/auth`);
		url.search = new URLSearchParams({
			client_id: STATIC_CLIENT_IDS.miuWeb,
			response_type: "code",
			scope: "openid",
			redirect_uri: MIU_CALLBACK,
		}).toString();
		const { location } = await browser.navigate(url, {}, MIU_CALLBACK);
		expect(location?.searchParams.get("error")).toBe("invalid_request");
		expect(location?.searchParams.get("error_description")).toMatch(/PKCE/);

		const wrong = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.miuWeb,
			client.ClientSecretBasic("w".repeat(43)),
		);
		await expect(
			codeTokens(wrong, browser, MIU_CALLBACK, MIU_SCOPE),
		).rejects.toMatchObject({ status: 401 });
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.miuWeb)
		)?.metadata();
		expect(metadata?.grant_types).toEqual(["authorization_code"]);
	});
});

describe("miu-mobile", () => {
	it("approves on a first-party page and returns a code to the app's scheme, without a refresh token", async () => {
		const { browser } = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.miuMobile,
			client.None(),
		);
		const verifier = client.randomPKCECodeVerifier();
		const state = client.randomState();
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: MIU_MOBILE_REDIRECT_URI,
			scope: MIU_SCOPE,
			state,
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: "S256",
		});
		const { response } = await browser.navigate(
			url,
			{},
			MIU_MOBILE_REDIRECT_URI,
		);
		const page = await response.text();
		// Native clients always show the approval page (oidc-provider's
		// native_client_prompt), worded as one of ours.
		expect(page).toContain('<b data-id="consent-client-name">Miu World</b>');
		expect(page).not.toContain('data-id="consent-external');
		const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
		if (!uid) throw new Error(`no approval page: ${response.status}`);
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/consent`,
			{ csrf: formField(page, "csrf") },
			MIU_MOBILE_REDIRECT_URI,
		);
		if (!back.location) throw new Error("did not return to the app");
		const tokens = await client.authorizationCodeGrant(config, back.location, {
			pkceCodeVerifier: verifier,
			expectedState: state,
		});
		expect(tokens.refresh_token).toBeUndefined();
		expect(decodeJwt(tokens.id_token ?? "").aud).toBe(
			STATIC_CLIENT_IDS.miuMobile,
		);
	});

	it("rejects any other redirect", async () => {
		const { browser } = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.miuMobile,
			client.None(),
		);
		for (const redirect of [
			"com.evil.miu:/auth/callback",
			"com.hoandat.scribe:/auth/callback",
			MIU_CALLBACK,
		]) {
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: redirect,
				scope: MIU_SCOPE,
				code_challenge: await client.calculatePKCECodeChallenge(
					client.randomPKCECodeVerifier(),
				),
				code_challenge_method: "S256",
			});
			const { response, location } = await browser.navigate(url, {}, redirect);
			expect(location, redirect).toBeUndefined();
			expect(response.status, redirect).toBe(400);
		}
	});
});

describe("miu-web-dev (local development)", () => {
	it("accepts its exact loopback redirect and has no back-channel", async () => {
		const { browser } = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.miuWebDev,
			client.ClientSecretBasic(MIU_WEB_DEV_SECRET),
		);
		const tokens = await codeTokens(
			config,
			browser,
			`${MIU_WEB_DEV_URL}/api/auth/callback`,
			MIU_SCOPE,
		);
		expect(tokens.id_token).toEqual(expect.any(String));
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.miuWebDev)
		)?.metadata();
		expect(metadata?.backchannel_logout_uri).toBeUndefined();
		const { location } = await browser.navigate(
			client.buildAuthorizationUrl(config, {
				redirect_uri: "http://localhost:5174/api/auth/callback",
				scope: MIU_SCOPE,
				code_challenge: await client.calculatePKCECodeChallenge(
					client.randomPKCECodeVerifier(),
				),
				code_challenge_method: "S256",
			}),
			{},
			"http://localhost:5174/",
		);
		expect(location).toBeUndefined();
	});
});

describe("other tenants", () => {
	it("have no Miu World client even with the same environment", async () => {
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			for (const id of [
				STATIC_CLIENT_IDS.miuWeb,
				STATIC_CLIENT_IDS.miuMobile,
				STATIC_CLIENT_IDS.miuWebDev,
			]) {
				expect(await other.provider.Client.find(id), id).toBeUndefined();
			}
		} finally {
			await other.close();
		}
	});
});

describe("buildMiuClients", () => {
	const ids = (clients: { client_id: string }[]) =>
		clients.map((c) => c.client_id).sort();

	it("with only the development client, also registers the app (not the site)", () => {
		const dev = { url: MIU_WEB_DEV_URL, secret: "d".repeat(32) };
		expect(
			ids(
				buildMiuClients(
					{ id: PRIMARY_TENANT_ID },
					{ mobileRedirectUri: MIU_MOBILE_REDIRECT_URI, dev },
				),
			),
		).toEqual(["miu-mobile", "miu-web-dev"]);
	});

	it("registers nothing when not configured", () => {
		expect(
			buildMiuClients(
				{ id: PRIMARY_TENANT_ID },
				{ mobileRedirectUri: MIU_MOBILE_REDIRECT_URI },
			),
		).toEqual([]);
	});
});
