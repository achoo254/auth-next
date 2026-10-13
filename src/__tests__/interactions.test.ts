import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";

const MCP_REDIRECT = "http://127.0.0.1:33419/callback";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function authorize(
	config: client.Configuration,
	redirectUri: string,
	params: Record<string, string>,
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
		...params,
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

describe("sign-up, consent and return to an MCP client", () => {
	it("creates an account through Google, asks consent and returns a code", async () => {
		const registered = await client.dynamicClientRegistration(
			new URL(idp.issuer),
			{
				redirect_uris: [MCP_REDIRECT],
				token_endpoint_auth_method: "none",
				client_name: "Claude Code",
				scope: "mock:read",
			},
			client.None(),
			{ execute: [client.allowInsecureRequests] },
		);
		const config = await discoverClient(
			idp,
			registered.clientMetadata().client_id,
			client.None(),
		);
		const { url, checks } = await authorize(config, MCP_REDIRECT, {
			scope: "mock:read",
			resource: RESOURCES.localmanMcp,
		});
		const browser = new TestBrowser();
		const login = await browser.navigate(url, {}, MCP_REDIRECT);
		const uid = /\/interaction\/([\w-]+)/.exec(login.response.url)?.[1] ?? "";
		expect(await login.response.text()).not.toContain('type="password"');

		idp.fake.nextLogins.push({
			id: "g-minh-anh",
			email: "Minh.Anh@Example.com",
			emailVerified: true,
		});
		const chosen = await browser.navigate(
			`${idp.issuer}/interaction/${uid}/upstream/google`,
		);
		const usernamePage = await chosen.response.text();
		expect(usernamePage).toContain("Choose a username");
		const consent = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/upstream/signup`,
			{ csrf: formField(usernamePage, "csrf"), username: "minh_anh" },
		);
		const consentPage = await consent.response.text();
		expect(consentPage).toContain(shown("consent.externalNotice"));
		expect(consentPage).toContain("127.0.0.1:33419");
		expect(consentPage).toContain(
			"See the Localman mock projects you can access",
		);
		expect(consentPage).not.toContain('data-id="consent-credentials-warning"');

		const consentUid =
			/\/interaction\/([\w-]+)/.exec(consent.response.url)?.[1] ?? "";
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${consentUid}/consent`,
			{ csrf: formField(consentPage, "csrf") },
			MCP_REDIRECT,
		);
		if (!back.location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(
			config,
			back.location,
			checks,
		);
		expect(tokens.access_token).toEqual(expect.any(String));

		const account = await repositoryOf(idp).findByEmail("minh.anh@example.com");
		expect(account).toMatchObject({
			username: "minh_anh",
			emailVerifiedBy: "google",
			providers: { google: "g-minh-anh" },
		});
		expect(account).not.toHaveProperty("passwordHash");
		expect(account).not.toHaveProperty("recoveryCodeHashes");
	});
});

describe("logout", () => {
	it("asks on its own page, signs out, and /account then needs a login", async () => {
		const browser = await signedInBrowser(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		expect(ask).toContain('id="op.logoutForm"');
		expect(ask).toContain("Sign out of your hoandat account");
		const done = await submitForm(
			browser,
			`${idp.issuer}/session/end/confirm`,
			{
				xsrf: formField(ask, "xsrf"),
				logout: "yes",
			},
		);
		expect(await done.response.text()).toContain("Signed out");
		const accountPage = await browser.request(`${idp.issuer}/account`);
		expect(accountPage.status).toBe(303);
		expect(accountPage.headers.get("location")).toContain(
			"client_id=hoandat-account",
		);
	});
});
