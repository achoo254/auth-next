import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { RESOURCES } from "../oidc/resources.js";
import {
	authorizeForCode,
	deviceLogin,
	discoverClient,
	runCodeFlow,
} from "./helpers/flows.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	TEST_ACCOUNT,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const TUNELO_SCOPE = "openid offline_access tunnels:open tunnels:read";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

function localmanWeb(): Promise<client.Configuration> {
	return discoverClient(
		idp,
		STATIC_CLIENT_IDS.localmanWeb,
		client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
	);
}

function tuneloCli(): Promise<client.Configuration> {
	return discoverClient(idp, STATIC_CLIENT_IDS.tuneloCli, client.None());
}

function isJwt(token: string): boolean {
	return token.split(".").length === 3;
}

describe("single use under concurrency", () => {
	it("lets only one of two simultaneous refreshes of a token succeed", async () => {
		const config = await tuneloCli();
		const tokens = await deviceLogin(config, TUNELO_SCOPE);
		const refreshToken = String(tokens.refresh_token);

		const results = await Promise.allSettled([
			client.refreshTokenGrant(config, refreshToken),
			client.refreshTokenGrant(config, refreshToken),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.find((r) => r.status === "rejected")).toMatchObject({
			reason: { error: "invalid_grant" },
		});
	});

	it("lets only one of two simultaneous code exchanges succeed", async () => {
		const config = await localmanWeb();
		const { location, checks } = await authorizeForCode(
			config,
			LOCALMAN_CALLBACK,
			{ scope: "openid" },
		);
		const results = await Promise.allSettled([
			client.authorizationCodeGrant(config, location, checks),
			client.authorizationCodeGrant(config, location, checks),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(results.find((r) => r.status === "rejected")).toMatchObject({
			reason: { error: "invalid_grant" },
		});
	});
});

describe("introspection policy", () => {
	it("hides other clients' tokens from a dynamically registered client", async () => {
		const tokens = await deviceLogin(await tuneloCli(), TUNELO_SCOPE);
		const refreshToken = String(tokens.refresh_token);

		const registered = await client.dynamicClientRegistration(
			new URL(idp.issuer),
			{
				redirect_uris: ["https://mcp.example.com/callback"],
				token_endpoint_auth_method: "client_secret_basic",
			},
			client.None(),
			{ execute: [client.allowInsecureRequests] },
		);
		const { client_id, client_secret } = registered.clientMetadata();
		const mcp = await discoverClient(
			idp,
			client_id,
			client.ClientSecretBasic(String(client_secret)),
		);
		expect(await client.tokenIntrospection(mcp, refreshToken)).toEqual({
			active: false,
		});

		// The token's own client and the first-party confidential apps may look.
		const own = await client.tokenIntrospection(
			await tuneloCli(),
			refreshToken,
		);
		expect(own).toMatchObject({ active: true, sub: TEST_ACCOUNT.sub });
		const firstParty = await client.tokenIntrospection(
			await localmanWeb(),
			refreshToken,
		);
		expect(firstParty).toMatchObject({ active: true });
	});
});

describe("default resource", () => {
	it("keeps a plain OpenID login on an opaque userinfo token", async () => {
		const config = await localmanWeb();
		const { tokens } = await runCodeFlow(config, LOCALMAN_CALLBACK, {
			scope: "openid profile",
		});
		expect(isJwt(tokens.access_token)).toBe(false);
		const userinfo = await client.fetchUserInfo(
			config,
			tokens.access_token,
			TEST_ACCOUNT.sub,
		);
		expect(userinfo).toMatchObject({
			sub: TEST_ACCOUNT.sub,
			preferred_username: TEST_ACCOUNT.username,
		});
	});

	it("binds the token to Localman once a Localman scope is requested", async () => {
		const { tokens } = await runCodeFlow(
			await localmanWeb(),
			LOCALMAN_CALLBACK,
			{
				scope: "openid mock:read",
			},
		);
		expect(isJwt(tokens.access_token)).toBe(true);
		expect(decodeJwt(tokens.access_token)).toMatchObject({
			aud: RESOURCES.localman,
			scope: "mock:read",
		});
	});
});
