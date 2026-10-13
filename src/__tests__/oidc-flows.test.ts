import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import {
	approveDevice,
	discoverClient,
	pollDeviceCode,
	runCodeFlow,
} from "./helpers/flows.js";
import { TestBrowser } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	TEST_ACCOUNT,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

let idp: TestIdp;
let jwksUri: string;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
	jwksUri = `${idp.issuer}/jwks`;
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

/** Device flow for tunelo-cli, approved by the test user. */
async function deviceLogin(): Promise<{
	config: client.Configuration;
	tokens: client.TokenEndpointResponse;
}> {
	const config = await tuneloCli();
	const authorization = await client.initiateDeviceAuthorization(config, {
		scope: "openid offline_access tunnels:open tunnels:read",
	});
	await expect(
		pollDeviceCode(config, authorization.device_code),
	).rejects.toMatchObject({ error: "authorization_pending" });

	const page = await approveDevice(
		authorization.verification_uri,
		authorization.user_code,
	);
	expect(page.status).toBe(200);

	const tokens = await pollDeviceCode(config, authorization.device_code);
	return { config, tokens };
}

describe("Authorization Code + PKCE (localman-web)", () => {
	it("issues an ES256 ID token bound to issuer, client and nonce", async () => {
		const { tokens, nonce } = await runCodeFlow(
			await localmanWeb(),
			LOCALMAN_CALLBACK,
			{
				// No offline_access: Localman's refresh token lives with the IdP session.
				scope: "openid profile email mock:read",
				resource: RESOURCES.localman,
			},
		);
		const idToken = tokens.id_token;
		if (!idToken) throw new Error("No id_token issued");

		const { payload, protectedHeader } = await jwtVerify(
			idToken,
			createRemoteJWKSet(new URL(jwksUri)),
			{
				issuer: idp.issuer,
				audience: STATIC_CLIENT_IDS.localmanWeb,
				algorithms: ["ES256"],
			},
		);
		expect(protectedHeader.kid).toBe(idp.jwks.keys[0]?.kid);
		expect(payload).toMatchObject({
			sub: TEST_ACCOUNT.sub,
			nonce,
			preferred_username: TEST_ACCOUNT.username,
			email: TEST_ACCOUNT.email,
			email_verified: false,
			telegram_linked: true,
		});
		expect(tokens.refresh_token).toEqual(expect.any(String));

		const access = await createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localman,
			jwksUri,
		})(tokens.access_token);
		expect(access).toMatchObject({ sub: TEST_ACCOUNT.sub, scope: "mock:read" });
	});

	it("requires PKCE even from the confidential client", async () => {
		const url = client.buildAuthorizationUrl(await localmanWeb(), {
			redirect_uri: LOCALMAN_CALLBACK,
			scope: "openid",
		});
		const { location } = await new TestBrowser().navigate(
			url,
			{},
			LOCALMAN_CALLBACK,
		);
		expect(location?.searchParams.get("error")).toBe("invalid_request");
		expect(location?.searchParams.get("error_description")).toMatch(/PKCE/);
	});
});

describe("Device Authorization Grant (tunelo-cli)", () => {
	it("answers authorization_pending until approved, then issues tokens", async () => {
		const { tokens } = await deviceLogin();
		expect(tokens.access_token).toEqual(expect.any(String));
		expect(tokens.id_token).toEqual(expect.any(String));
		expect(tokens.refresh_token).toEqual(expect.any(String));
		expect(decodeProtectedHeader(tokens.access_token).typ).toBe("at+jwt");
	});
});

describe("Refresh token rotation", () => {
	it("rotates on use and revokes the whole grant when an old one is replayed", async () => {
		const { config, tokens } = await deviceLogin();
		const original = tokens.refresh_token;
		if (!original) throw new Error("No refresh_token issued");

		const rotated = await client.refreshTokenGrant(config, original);
		const next = rotated.refresh_token;
		if (!next) throw new Error("No rotated refresh_token issued");
		expect(next).not.toBe(original);

		await expect(
			client.refreshTokenGrant(config, original),
		).rejects.toMatchObject({
			error: "invalid_grant",
		});
		// The replay revoked the grant, so the newest token died with it.
		await expect(client.refreshTokenGrant(config, next)).rejects.toMatchObject({
			error: "invalid_grant",
		});
	});
});

describe("Access token audience", () => {
	it("binds Tunelo tokens to Tunelo; Localman's verifier rejects them", async () => {
		const { tokens } = await deviceLogin();
		const verifyForTunelo = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.tunnel,
			jwksUri,
		});
		const verifyForLocalman = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localman,
			jwksUri,
		});

		const payload = await verifyForTunelo(tokens.access_token);
		expect(payload).toMatchObject({
			aud: RESOURCES.tunnel,
			sub: TEST_ACCOUNT.sub,
			client_id: STATIC_CLIENT_IDS.tuneloCli,
		});
		expect(String(payload.scope).split(" ").sort()).toEqual([
			"tunnels:open",
			"tunnels:read",
		]);
		expect(Number(payload.exp) - Number(payload.iat)).toBe(15 * 60);
		await expect(verifyForLocalman(tokens.access_token)).rejects.toMatchObject({
			code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
			claim: "aud",
		});
	});

	it("never accepts an ID token as an access token", async () => {
		const { tokens } = await deviceLogin();
		const verify = createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: STATIC_CLIENT_IDS.tuneloCli,
			jwksUri,
		});
		await expect(verify(String(tokens.id_token))).rejects.toThrow();
	});
});
