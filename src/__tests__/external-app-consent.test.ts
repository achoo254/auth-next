import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderConsent } from "../interactions/consent-page.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { escapeHtml } from "../ui/html.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown, testPage } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

/** Claude Code listens on a random localhost port for the callback. */
const MCP_REDIRECT = "http://localhost:33422/callback";
/** A web app's callback: the code leaves the user's machine. */
const WEB_REDIRECT = "https://agent.example.test/callback";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function registerMcpClient(
	name: string,
	redirect = MCP_REDIRECT,
): Promise<client.Configuration> {
	const registered = await client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [redirect],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			client_name: name,
			scope: "mock:read",
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
	return discoverClient(
		idp,
		registered.clientMetadata().client_id,
		client.None(),
	);
}

async function authorizationUrl(
	config: client.Configuration,
	redirect = MCP_REDIRECT,
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirect,
		scope: "mock:read",
		resource: RESOURCES.localmanMcp,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

/** Opens the consent page of `name` in a signed-in browser. */
async function consentPageFor(name: string, redirect = MCP_REDIRECT) {
	const account = await createTestAccount(repositoryOf(idp));
	const browser = await signedInBrowser(idp, account);
	const config = await registerMcpClient(name, redirect);
	const { url, checks } = await authorizationUrl(config, redirect);
	const { response } = await browser.navigate(url, {}, redirect);
	const page = await response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
	if (!uid) throw new Error(`no consent page: ${response.status}`);
	return { browser, config, checks, page, uid };
}

describe("consent for an app registered through DCR", () => {
	it("labels Claude Code as external, shows its redirect host, then runs code, token and refresh", async () => {
		const name = "Claude Code (localman)";
		const { browser, config, checks, page, uid } = await consentPageFor(name);
		expect(page).toContain(
			`“<b data-id="consent-client-name">${escapeHtml(name)}</b>”`,
		);
		expect(page).toContain('data-id="consent-external"');
		expect(page).toContain(shown("consent.externalNotice"));
		expect(page).toContain(
			'<code data-id="consent-redirect-host">localhost:33422</code>',
		);
		// "localman" reads like ours, but the code only reaches this machine.
		expect(page).not.toContain('data-id="consent-lookalike-warning"');

		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/consent`,
			{ csrf: formField(page, "csrf") },
			MCP_REDIRECT,
		);
		if (!back.location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(
			config,
			back.location,
			checks,
		);
		const verify = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localmanMcp,
			jwksUri: `${idp.issuer}/jwks`,
		});
		await verify(tokens.access_token);
		if (!tokens.refresh_token) throw new Error("no refresh token");
		const refreshed = await client.refreshTokenGrant(
			config,
			tokens.refresh_token,
		);
		await verify(refreshed.access_token);
		expect(refreshed.refresh_token).not.toBe(tokens.refresh_token);

		// /account lists it as an external app; localman-web stays first-party.
		const { client_id } = config.clientMetadata();
		const account = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		expect(account).toContain(`data-id="app-external-${client_id}"`);
		expect(account).toContain(`“<b>${escapeHtml(name)}</b>”`);
		expect(account).not.toContain(
			`data-id="app-external-${STATIC_CLIENT_IDS.localmanWeb}"`,
		);
		expect(account).toContain(
			'<b>Localman</b> <span class="badge badge-neutral">hoandat</span>',
		);
	});

	it("warns hard on a lookalike name that returns to a website", async () => {
		const { page } = await consentPageFor("Claude (localman)", WEB_REDIRECT);
		expect(page).toContain(shown("consent.externalNotice"));
		expect(page).toContain(shown("consent.lookalikeWarning"));
		expect(page).toContain(
			'<code data-id="consent-redirect-host">agent.example.test</code>',
		);
	});

	it("registers a Cyrillic lookalike but warns hard on consent", async () => {
		const { page } = await consentPageFor("Tun\u0435lo", WEB_REDIRECT);
		expect(page).toContain(shown("consent.externalNotice"));
		expect(page).toContain(shown("consent.lookalikeWarning"));
		expect(page).toContain(
			'“<b data-id="consent-client-name">Tun\u0435lo</b>”',
		);
	});

	it("escapes a neutral name and adds no lookalike warning", async () => {
		const { page } = await consentPageFor("Agent <img src=x>");
		expect(page).toContain("Agent &lt;img src=x&gt;");
		expect(page).not.toContain("<img src=x>");
		expect(page).toContain(shown("consent.externalNotice"));
		expect(page).not.toContain('data-id="consent-lookalike-warning"');
	});

	it("names an external app as such on the login and logout pages", async () => {
		const config = await registerMcpClient("Localman");
		const { url } = await authorizationUrl(config);
		const { response } = await new TestBrowser().navigate(
			url,
			{},
			MCP_REDIRECT,
		);
		const label = "“<b>Localman</b>” (external app)";
		expect(await response.text()).toContain(`To continue to ${label}.`);
		const firstParty = await openLoginPage(idp);
		expect(firstParty.html).toContain("Sign in to continue to Localman");

		// Without a session the provider skips the question altogether.
		const browser = await signedInBrowser(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		const logout = await browser.request(
			`${idp.issuer}/session/end?client_id=${config.clientMetadata().client_id}`,
		);
		expect(await logout.text()).toContain(`${label} wants to sign you out`);
	});
});

describe("consent for a first-party client", () => {
	it("shows no external label, notice or quotes", () => {
		const page = renderConsent({
			host: "auth.example.test",
			page: testPage(),
			csrf: "csrf-token",
			uid: "uid-1",
			clientName: "Tunelo CLI",
			external: false,
			imitatesFirstParty: false,
			redirectHost: "127.0.0.1:8976",
			scopes: ["openid", "tunnels:read"],
			username: "minh_anh",
		});
		expect(page).toContain('<b data-id="consent-client-name">Tunelo CLI</b>');
		expect(page).not.toContain("“");
		expect(page).not.toContain('data-id="consent-external');
		expect(page).not.toContain('data-id="consent-lookalike-warning"');
	});
});
