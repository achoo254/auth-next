import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { BOTS_ADMIN_SCOPE, CHAT_MCP_SCOPES } from "../oidc/resources.js";
import { authorizationRedirect, discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

const MCP_REDIRECT = "http://127.0.0.1:33422/callback";

let idp: TestIdp;
let browser: TestBrowser;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
	browser = await signedInBrowser(
		idp,
		await createTestAccount(repositoryOf(idp)),
	);
});

afterAll(async () => {
	await idp?.close();
});

function register(
	metadata: Partial<client.ClientMetadata> = {},
): Promise<client.Configuration> {
	return client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [MCP_REDIRECT],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			client_name: "Agent",
			...metadata,
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
}

interface ConsentResult {
	readonly page: string;
	readonly tokens: client.TokenEndpointResponse;
}

/** Opens the consent page, allows it and redeems the code. */
async function consentAndRedeem(
	config: client.Configuration,
	scope: string,
	resource?: string,
): Promise<ConsentResult> {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: MCP_REDIRECT,
		scope,
		...(resource ? { resource } : {}),
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
	});
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
	const tokens = await client.authorizationCodeGrant(config, back.location, {
		pkceCodeVerifier: verifier,
		expectedState: state,
	});
	return { page, tokens };
}

/** The sorted scopes of an access token, verified for `audience`. */
async function scopesFor(
	audience: string,
	{ tokens }: ConsentResult,
): Promise<string[]> {
	const payload = await createAccessTokenVerifier({
		issuer: idp.issuer,
		audience,
		jwksUri: `${idp.issuer}/jwks`,
	})(tokens.access_token);
	return String(payload.scope).split(" ").sort();
}

describe("Chat MCP resource for DCR clients", () => {
	it("advertises the Chat MCP scopes in discovery", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		const metadata = (await response.json()) as { scopes_supported: unknown };
		expect(metadata.scopes_supported).toEqual(
			expect.arrayContaining([...CHAT_MCP_SCOPES]),
		);
	});

	it("issues a token for the chat /mcp audience with the requested scopes", async () => {
		const config = await register({ scope: "chat:read bots:read" });
		const result = await consentAndRedeem(
			config,
			"chat:read bots:read",
			RESOURCES.chatMcp,
		);
		expect(await scopesFor(RESOURCES.chatMcp, result)).toEqual([
			"bots:read",
			"chat:read",
		]);
	});

	it("still issues Localman MCP tokens to the same kind of client", async () => {
		const config = await register({ scope: "mock:read chat:read" });
		const result = await consentAndRedeem(
			config,
			"mock:read",
			RESOURCES.localmanMcp,
		);
		expect(await scopesFor(RESOURCES.localmanMcp, result)).toEqual([
			"mock:read",
		]);
	});

	it("binds a request without resource but with chat scopes to chat /mcp", async () => {
		const config = await register();
		const result = await consentAndRedeem(config, "chat:read chat:write");
		expect(await scopesFor(RESOURCES.chatMcp, result)).toEqual([
			"chat:read",
			"chat:write",
		]);
	});

	it("leaves bots:admin out of the default scope", async () => {
		const config = await register();
		const scopes = String(config.clientMetadata().scope).split(" ");
		expect(scopes).toEqual(expect.arrayContaining(["chat:read", "bots:write"]));
		expect(scopes).not.toContain(BOTS_ADMIN_SCOPE);
		const location = await authorizationRedirect(config, MCP_REDIRECT, {
			scope: `bots:read ${BOTS_ADMIN_SCOPE}`,
			resource: RESOURCES.chatMcp,
		});
		expect(location.searchParams.get("error")).toBe("invalid_scope");
	});

	it("warns about a declared bots:admin on consent, then grants it", async () => {
		const scope = `bots:read ${BOTS_ADMIN_SCOPE}`;
		const config = await register({ scope });
		const result = await consentAndRedeem(config, scope, RESOURCES.chatMcp);
		expect(result.page).toMatch(
			/<div class="alert alert-error"[^>]*><span data-id="consent-bots-admin-warning">/,
		);
		expect(result.page).toContain(shown("consent.botsAdminWarning"));
		expect(result.page).not.toContain('data-id="consent-credentials-warning"');
		expect(await scopesFor(RESOURCES.chatMcp, result)).toEqual([
			BOTS_ADMIN_SCOPE,
			"bots:read",
		]);
	});
});

describe("allowed_resources of DCR clients", () => {
	it("accepts a subset of the MCP resources and widens it to both", async () => {
		const registered = await register({
			allowed_resources: [RESOURCES.localmanMcp],
		});
		expect(registered.clientMetadata().allowed_resources).toEqual([
			RESOURCES.localmanMcp,
			RESOURCES.chatMcp,
		]);
	});

	it("still loads a client stored with only the Localman MCP resource", async () => {
		const { client_id } = (
			await register({ scope: "mock:read chat:read" })
		).clientMetadata();
		await idp.db
			.collection<{ _id: string }>(collectionNameFor("Client"))
			.updateOne(
				{ _id: client_id },
				{ $set: { "payload.allowed_resources": [RESOURCES.localmanMcp] } },
			);
		const config = await discoverClient(idp, client_id, client.None());
		const result = await consentAndRedeem(
			config,
			"chat:read",
			RESOURCES.chatMcp,
		);
		expect(await scopesFor(RESOURCES.chatMcp, result)).toEqual(["chat:read"]);
	});

	it.each([
		["an unknown resource", ["https://evil.example/mcp"]],
		[
			"an MCP resource next to a non-MCP one",
			[RESOURCES.chatMcp, RESOURCES.tunnel],
		],
		["an empty list", []],
	])("rejects %s", async (_label, resources) => {
		await expect(
			register({ allowed_resources: resources }),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});
});
