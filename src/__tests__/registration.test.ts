import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESOURCES } from "../oidc/resources.js";
import {
	authorizationRedirect,
	discoverClient,
	runCodeFlow,
} from "./helpers/flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

const MCP_REDIRECT = "http://127.0.0.1:33418/callback";

let idp: TestIdp;

beforeAll(async () => {
	// This suite registers more clients than the production /reg budget
	// (20 per hour per IP) allows; rate limiting has its own tests.
	idp = await startTestIdp({ interactions: "auto", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function register(
	metadata: Partial<client.ClientMetadata>,
): Promise<client.Configuration> {
	return client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [MCP_REDIRECT],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			...metadata,
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
}

/** Registers an MCP client, then reloads it the way a real client would. */
async function registerMcpClient(scope: string): Promise<client.Configuration> {
	const registered = await register({ scope });
	return discoverClient(
		idp,
		registered.clientMetadata().client_id,
		client.None(),
	);
}

describe("Dynamic Client Registration policy (MCP clients)", () => {
	it("registers a loopback MCP client bound to the /mcp resource", async () => {
		const registered = await register({ scope: "mock:read client:send" });
		const metadata = registered.clientMetadata();
		expect(metadata.scope).toBe("mock:read client:send");
		expect(metadata.allowed_resources).toEqual([RESOURCES.localmanMcp]);
	});

	it("defaults the scope to the Localman API scopes", async () => {
		const metadata = (await register({})).clientMetadata();
		expect(String(metadata.scope).split(" ")).toEqual([
			"mock:read",
			"mock:write",
			"client:read",
			"client:write",
			"client:send",
		]);
	});

	it.each([
		["a Tunelo scope", "mock:read tunnels:open"],
		["an OIDC scope", "openid mock:read"],
		["an unknown scope", "admin"],
	])("rejects %s", async (_label, scope) => {
		await expect(register({ scope })).rejects.toMatchObject({
			error: "invalid_client_metadata",
		});
	});

	it.each([
		"http://evil.com/callback",
		"http://192.168.1.10/callback",
		"myapp://callback",
	])("rejects redirect URI %s", async (redirectUri) => {
		await expect(
			register({ redirect_uris: [redirectUri] }),
		).rejects.toMatchObject({
			error: "invalid_redirect_uri",
		});
	});

	it.each([
		"Claude Code (localman)",
		"Localman",
		"Tun\u0435lo", // Cyrillic е
		"h\u043eandat", // Cyrillic о
		"Cursor",
		"a".repeat(100),
	])("accepts the self-declared client_name %s", async (clientName) => {
		const metadata = (
			await register({ client_name: clientName })
		).clientMetadata();
		expect(metadata.client_name).toBe(clientName);
	});

	it.each([
		["a blank name", "   "],
		["a name over 100 characters", "a".repeat(101)],
		["a control character", "Agent\u0007"],
		["a line break", "Agent\nLocalman"],
		["a line separator", "Agent\u2028"],
		["a bidi override", "Agent \u202enamlacol"],
		["a bidi isolate", "\u2066Agent\u2069"],
	])("rejects a client_name with %s", async (_label, clientName) => {
		await expect(register({ client_name: clientName })).rejects.toMatchObject({
			error: "invalid_client_metadata",
		});
	});

	it.each([
		["logo_uri", "https://evil.example/logo.png"],
		["client_uri", "https://evil.example"],
		["policy_uri", "https://evil.example/policy"],
		["tos_uri", "https://evil.example/tos"],
		["backchannel_logout_uri", "https://evil.example/logout"],
	])("rejects %s", async (property, value) => {
		await expect(register({ [property]: value })).rejects.toMatchObject({
			error: "invalid_client_metadata",
		});
	});

	it("rejects a client that tries to pick its own resources", async () => {
		await expect(
			register({ allowed_resources: [RESOURCES.tunnel] }),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});

	it("rejects grants other than code and refresh", async () => {
		await expect(
			register({
				grant_types: ["urn:ietf:params:oauth:grant-type:device_code"],
			}),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});

	it.each([RESOURCES.tunnel, RESOURCES.localman])(
		"refuses tokens for resource %s",
		async (resource) => {
			const config = await registerMcpClient("mock:read");
			const location = await authorizationRedirect(config, MCP_REDIRECT, {
				scope: "mock:read",
				resource,
			});
			expect(location.searchParams.get("error")).toBe("invalid_target");
		},
	);

	it("issues /mcp access tokens and a refresh token", async () => {
		const config = await registerMcpClient("mock:read client:read");
		const { tokens } = await runCodeFlow(config, MCP_REDIRECT, {
			scope: "mock:read client:read",
			resource: RESOURCES.localmanMcp,
		});
		const payload = await createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localmanMcp,
			jwksUri: `${idp.issuer}/jwks`,
		})(tokens.access_token);
		expect(String(payload.scope).split(" ").sort()).toEqual([
			"client:read",
			"mock:read",
		]);
		expect(tokens.refresh_token).toEqual(expect.any(String));
	});
});
