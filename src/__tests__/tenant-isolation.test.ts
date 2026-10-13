import { randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { MongoClient } from "mongodb";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import {
	codeTokens,
	exchange,
	localmanWeb,
	rejectedWith,
} from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { accountPageStatus, signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	type TestIdp,
	localmanCallbackOf,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT, RESOURCES } from "./helpers/test-tenant.js";

/**
 * Two tenants in one database, as in one IdP process: the primary one
 * (hoandat.com) and example.org. Nothing issued by one works at the other.
 */
const mongoUrl = `${inject("mongoUri").replace(/\/$/, "")}/tenants_${randomUUID().slice(0, 8)}`;
let primary: TestIdp;
let other: TestIdp;
let account: TestAccount;

beforeAll(async () => {
	primary = await startTestIdp({ interactions: "real", mongoUrl });
	other = await startTestIdp({
		interactions: "real",
		mongoUrl,
		tenant: OTHER_TEST_TENANT,
	});
	account = await createTestAccount(repositoryOf(primary));
});

afterAll(async () => {
	await other?.close();
	await primary?.close();
	const mongo = new MongoClient(mongoUrl);
	await mongo.connect();
	await mongo.db().dropDatabase();
	await mongo.close();
});

/** localman-web of the other tenant (same client id and secret). */
function otherLocalman(): Promise<client.Configuration> {
	return discoverClient(
		other,
		STATIC_CLIENT_IDS.localmanWeb,
		client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
	);
}

async function tokenRequest(
	idp: TestIdp,
	form: Record<string, string>,
): Promise<{ status: number; error?: string }> {
	const response = await fetch(`${idp.issuer}/token`, {
		method: "POST",
		headers: {
			authorization: `Basic ${Buffer.from(`${STATIC_CLIENT_IDS.localmanWeb}:${LOCALMAN_WEB_SECRET}`).toString("base64")}`,
			"content-type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams(form),
	});
	const body: unknown = await response.json();
	const error =
		typeof body === "object" && body !== null
			? Reflect.get(body, "error")
			: undefined;
	return {
		status: response.status,
		error: typeof error === "string" ? error : undefined,
	};
}

describe("tenant isolation", () => {
	it("publishes its own discovery and keys", async () => {
		const discovery = async (idp: TestIdp): Promise<unknown> =>
			(await fetch(`${idp.issuer}/.well-known/openid-configuration`)).json();
		expect(await discovery(primary)).toMatchObject({ issuer: primary.issuer });
		expect(await discovery(other)).toMatchObject({ issuer: other.issuer });
		const kids = (idp: TestIdp): string[] =>
			idp.jwks.keys.map((key) => key.kid);
		expect(kids(other).some((kid) => kids(primary).includes(kid))).toBe(false);
	});

	// The test browser keeps one cookie jar for every port, so the session
	// cookie of the primary tenant reaches the other one too.
	it("does not know the other tenant's IdP session", async () => {
		const browser = await signedInBrowser(primary, account);
		expect(await accountPageStatus(primary, browser)).toBe(200);
		expect(await accountPageStatus(other, browser)).toBe(303);
	});

	it("refuses access, refresh and ID tokens of the other tenant", async () => {
		const tokens = await codeTokens(
			await localmanWeb(primary),
			await signedInBrowser(primary, account),
			LOCALMAN_CALLBACK,
			"openid profile email",
		);
		const userinfo = await fetch(`${other.issuer}/me`, {
			headers: { authorization: `Bearer ${tokens.access_token}` },
		});
		expect(userinfo.status).toBe(401);
		expect(
			await tokenRequest(other, {
				grant_type: "refresh_token",
				refresh_token: tokens.refresh_token ?? "",
			}),
		).toMatchObject({ status: 400, error: "invalid_grant" });
		const otherKeys = createRemoteJWKSet(new URL(`${other.issuer}/jwks`));
		await expect(
			jwtVerify(tokens.id_token ?? "", otherKeys, { issuer: other.issuer }),
		).rejects.toThrow();
		await expect(
			exchange(await otherLocalman(), tokens.access_token, {
				resource: "https://tunnel.example.org",
			}),
		).rejects.toMatchObject(rejectedWith("invalid_request"));
	});

	it("refuses an authorization code of the other tenant", async () => {
		const browser = await signedInBrowser(primary, account);
		const verifier = client.randomPKCECodeVerifier();
		const url = client.buildAuthorizationUrl(await localmanWeb(primary), {
			redirect_uri: LOCALMAN_CALLBACK,
			scope: "openid",
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: "S256",
		});
		const { location } = await browser.navigate(url, {}, LOCALMAN_CALLBACK);
		const code = location?.searchParams.get("code") ?? "";
		expect(code).not.toBe("");
		expect(
			await tokenRequest(other, {
				grant_type: "authorization_code",
				code,
				redirect_uri: LOCALMAN_CALLBACK,
				code_verifier: verifier,
			}),
		).toMatchObject({ status: 400, error: "invalid_grant" });
	});

	it("refuses a device code of the other tenant", async () => {
		const cli = await discoverClient(
			primary,
			STATIC_CLIENT_IDS.tuneloCli,
			client.None(),
		);
		const device = await client.initiateDeviceAuthorization(cli, {
			scope: "openid tunnels:open",
		});
		const response = await fetch(`${other.issuer}/token`, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				device_code: device.device_code,
				client_id: STATIC_CLIENT_IDS.tuneloCli,
			}),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: "invalid_grant" });
	});

	// The primary tenant also matches untagged pre-tenant data ($in with
	// null); it must still never match another tenant's documents.
	it("lets the primary tenant refuse everything the other tenant issued", async () => {
		const theirs = await createTestAccount(repositoryOf(other));
		const otherBrowser = await signedInBrowser(other, theirs);
		expect(await accountPageStatus(other, otherBrowser)).toBe(200);
		const tokens = await codeTokens(
			await otherLocalman(),
			otherBrowser,
			localmanCallbackOf(other),
			"openid profile email",
		);
		const userinfo = await fetch(`${primary.issuer}/me`, {
			headers: { authorization: `Bearer ${tokens.access_token}` },
		});
		expect(userinfo.status).toBe(401);
		expect(
			await tokenRequest(primary, {
				grant_type: "refresh_token",
				refresh_token: tokens.refresh_token ?? "",
			}),
		).toMatchObject({ status: 400, error: "invalid_grant" });
		await expect(
			exchange(await localmanWeb(primary), tokens.access_token),
		).rejects.toMatchObject(rejectedWith("invalid_request"));
		const verifier = client.randomPKCECodeVerifier();
		const url = client.buildAuthorizationUrl(await otherLocalman(), {
			redirect_uri: localmanCallbackOf(other),
			scope: "openid",
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: "S256",
		});
		const { location } = await otherBrowser.navigate(
			url,
			{},
			localmanCallbackOf(other),
		);
		expect(
			await tokenRequest(primary, {
				grant_type: "authorization_code",
				code: location?.searchParams.get("code") ?? "",
				redirect_uri: LOCALMAN_CALLBACK,
				code_verifier: verifier,
			}),
		).toMatchObject({ status: 400, error: "invalid_grant" });
		// Last: the primary tenant's portal clears the cookie it cannot use.
		expect(await accountPageStatus(primary, otherBrowser)).toBe(303);
	});

	it("issues tokens only for its own resources", async () => {
		const resources = (idp: TestIdp): unknown =>
			idp.provider.Client.find(STATIC_CLIENT_IDS.localmanWeb).then(
				(found) => found?.metadata().allowed_resources,
			);
		expect(await resources(primary)).toEqual([RESOURCES.localman]);
		expect(await resources(other)).toEqual(["https://localman.example.org"]);
	});
});
