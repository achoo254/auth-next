import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	ACCOUNT_IOS_CLIENT_ID,
	buildAccountIosClients,
} from "../oidc/account-ios-client.js";
import { refreshesPerDevice } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { hasHardCap } from "../oidc/sliding-grants.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import {
	ACCOUNT_IOS_SCOPE,
	accountIosConfig,
	appSignIn,
	iosCallbackOf,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("account-ios", () => {
	it("signs in with Code + PKCE after approval: an opaque token with scope account, auth_time in the ID token", async () => {
		const { tokens, account } = await signedInApp(idp);
		expect(tokens.access_token.split(".")).toHaveLength(1);
		expect(tokens.scope?.split(" ")).toContain("account");
		const claims = decodeJwt(tokens.id_token ?? "");
		expect(claims.sub).toBe(account._id);
		expect(claims.aud).toBe(ACCOUNT_IOS_CLIENT_ID);
		expect(typeof claims.auth_time).toBe("number");
		expect(tokens.refresh_token).toEqual(expect.any(String));
	});

	it("rotates refresh tokens, keeps them after IdP sign-out, and keeps the 90-day cap", async () => {
		const { tokens } = await signedInApp(idp);
		const config = await accountIosConfig(idp);
		const first = tokens.refresh_token ?? "";
		const refreshed = await client.refreshTokenGrant(config, first);
		expect(refreshed.refresh_token).toEqual(expect.any(String));
		expect(refreshed.refresh_token).not.toBe(first);
		await expect(client.refreshTokenGrant(config, first)).rejects.toMatchObject(
			{ error: "invalid_grant" },
		);
		expect(refreshesPerDevice(ACCOUNT_IOS_CLIENT_ID)).toBe(true);
		expect(hasHardCap(ACCOUNT_IOS_CLIENT_ID)).toBe(true);
	});

	it("is a new grant per sign-in, one device row each", async () => {
		const { account, browser } = await signedInApp(idp);
		await appSignIn(idp, browser);
		const grants = await idp.db
			.collection(collectionNameFor("Grant"))
			.countDocuments({
				"payload.accountId": account._id,
				"payload.clientId": ACCOUNT_IOS_CLIENT_ID,
			});
		expect(grants).toBe(2);
		const metas = await idp.db
			.collection("grant_meta")
			.countDocuments({ accountId: account._id });
		expect(metas).toBe(2);
	});

	it("requires PKCE and refuses any other redirect", async () => {
		const { browser } = await signedInApp(idp);
		const config = await accountIosConfig(idp);
		const noPkce = new URL(`${idp.issuer}/auth`);
		noPkce.search = new URLSearchParams({
			client_id: ACCOUNT_IOS_CLIENT_ID,
			response_type: "code",
			scope: ACCOUNT_IOS_SCOPE,
			redirect_uri: iosCallbackOf(idp),
		}).toString();
		const { location } = await browser.navigate(noPkce, {}, iosCallbackOf(idp));
		expect(location?.searchParams.get("error")).toBe("invalid_request");
		for (const redirect of [
			"com.hoandat.account:/auth/callback",
			"https://evil.example/ios/callback",
			`${idp.issuer}/ios/other`,
		]) {
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: redirect,
				scope: ACCOUNT_IOS_SCOPE,
				code_challenge: await client.calculatePKCECodeChallenge(
					client.randomPKCECodeVerifier(),
				),
				code_challenge_method: "S256",
			});
			const answer = await browser.navigate(url, {}, redirect);
			expect(answer.location, redirect).toBeUndefined();
			expect(answer.response.status, redirect).toBe(400);
		}
	});
});

describe("other tenants", () => {
	it("have no account-ios client", async () => {
		expect(
			buildAccountIosClients({ id: "t_other", issuer: "https://auth.x.test" }),
		).toEqual([]);
		expect(
			buildAccountIosClients({
				id: PRIMARY_TENANT_ID,
				issuer: "https://auth.x.test",
			}),
		).toHaveLength(1);
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			expect(
				await other.provider.Client.find(ACCOUNT_IOS_CLIENT_ID),
			).toBeUndefined();
			const api = await fetch(`${other.issuer}/api/account`);
			expect(api.status).toBe(404);
		} finally {
			await other.close();
		}
	});
});
