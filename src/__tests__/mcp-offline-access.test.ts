import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { CREDENTIALS_SCOPE } from "../oidc/resources.js";
import { localmanWeb, rejectedWith } from "./helpers/exchange-flows.js";
import { authorizationRedirect } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

const MCP_REDIRECT = "http://127.0.0.1:33421/callback";
/** What MCP SDKs register and request once discovery lists offline_access. */
const SDK_SCOPE = "mock:read mock:write offline_access";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function registerMcpClient(scope: string): Promise<client.Configuration> {
	return client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [MCP_REDIRECT],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			client_name: "Agent",
			scope,
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
}

function scopesOf(config: client.Configuration): string[] {
	return String(config.clientMetadata().scope).split(" ");
}

async function storedScopeOf(clientId: string): Promise<unknown> {
	const stored = await idp.db
		.collection<{ _id: string; payload: { scope?: unknown } }>(
			collectionNameFor("Client"),
		)
		.findOne({ _id: clientId });
	if (!stored) throw new Error("registered client not stored");
	return stored.payload.scope;
}

/** The authorization request an MCP SDK sends: offline_access forces prompt=consent. */
async function sdkAuthorizationUrl(config: client.Configuration) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: MCP_REDIRECT,
		scope: SDK_SCOPE,
		prompt: "consent",
		resource: RESOURCES.localmanMcp,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

async function consentAndReturn(browser: TestBrowser, url: URL): Promise<URL> {
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
	return back.location;
}

describe("offline_access from a DCR (MCP) client", () => {
	it("is dropped at registration, not refused, and never stored", async () => {
		const config = await registerMcpClient(SDK_SCOPE);
		expect(scopesOf(config)).toEqual(["mock:read", "mock:write"]);
		const { client_id } = config.clientMetadata();
		expect(await storedScopeOf(client_id)).toBe("mock:read mock:write");
	});

	it("alone falls back to the default scopes, still without credentials:write", async () => {
		const scopes = scopesOf(await registerMcpClient("offline_access"));
		expect(scopes).not.toContain("offline_access");
		expect(scopes).not.toContain(CREDENTIALS_SCOPE);
		expect(scopes).toContain("mock:read");
	});

	it("keeps credentials:write only when declared next to it", async () => {
		const config = await registerMcpClient(
			`mock:read ${CREDENTIALS_SCOPE} offline_access`,
		);
		expect(scopesOf(config)).toEqual(["mock:read", CREDENTIALS_SCOPE]);
	});

	it.each([
		["an unknown scope", "offline_access admin"],
		["a Tunelo scope", "mock:read tunnels:open offline_access"],
		["an OIDC scope", "openid mock:read offline_access"],
		["the telegram scope", "telegram offline_access"],
	])("does not excuse %s", async (_label, scope) => {
		await expect(registerMcpClient(scope)).rejects.toMatchObject({
			error: "invalid_client_metadata",
		});
	});

	it("is ignored at authorization; code, refresh and logout work as before", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const config = await registerMcpClient(SDK_SCOPE);
		const { url, checks } = await sdkAuthorizationUrl(config);
		const location = await consentAndReturn(browser, url);
		expect(location.searchParams.get("error")).toBeNull();

		const tokens = await client.authorizationCodeGrant(
			config,
			location,
			checks,
		);
		const verify = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localmanMcp,
			jwksUri: `${idp.issuer}/jwks`,
		});
		const payload = await verify(tokens.access_token);
		expect(String(payload.scope).split(" ").sort()).toEqual([
			"mock:read",
			"mock:write",
		]);
		const firstRefresh = tokens.refresh_token;
		if (!firstRefresh) throw new Error("no refresh token for the MCP client");

		const refreshed = await client.refreshTokenGrant(config, firstRefresh);
		await verify(refreshed.access_token);
		const nextRefresh = refreshed.refresh_token;
		if (!nextRefresh) throw new Error("refresh did not rotate the token");

		// Still bound to the IdP session: signing out ends the MCP grant.
		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf: formField(ask, "xsrf"),
			logout: "yes",
		});
		await expect(
			client.refreshTokenGrant(config, nextRefresh),
		).rejects.toMatchObject(rejectedWith("invalid_grant"));
	});

	it("is still refused from a static client that does not hold it", async () => {
		const location = await authorizationRedirect(
			await localmanWeb(idp),
			LOCALMAN_CALLBACK,
			{ scope: "openid offline_access", prompt: "consent" },
		);
		expect(location.searchParams.get("error")).toBe("invalid_scope");
	});

	it("does not let a DCR client authorize a scope it did not register", async () => {
		const config = await registerMcpClient(SDK_SCOPE);
		const location = await authorizationRedirect(config, MCP_REDIRECT, {
			scope: `mock:read ${CREDENTIALS_SCOPE} offline_access`,
			prompt: "consent",
			resource: RESOURCES.localmanMcp,
		});
		expect(location.searchParams.get("error")).toBe("invalid_scope");
	});
});
