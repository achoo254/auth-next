import { randomUUID } from "node:crypto";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	accountIosConfig,
	appSignIn,
	callApi,
	forgeIdToken,
	signedInApp,
} from "./helpers/account-ios-flows.js";
import { localmanSignIn } from "./helpers/exchange-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

interface Endpoint {
	readonly method: string;
	readonly path: string;
	readonly sensitive: boolean;
}

/** Every route of the guard table, plus push registration. */
const ENDPOINTS: readonly Endpoint[] = [
	{ method: "GET", path: "/", sensitive: false },
	{ method: "PATCH", path: "/profile", sensitive: false },
	{ method: "POST", path: "/sessions/s1/revoke", sensitive: false },
	{ method: "POST", path: "/devices/g1/revoke", sensitive: false },
	{ method: "PUT", path: "/push-device", sensitive: false },
	{ method: "DELETE", path: "/push-device", sensitive: false },
	{ method: "POST", path: "/apps/localman-web/revoke", sensitive: true },
	{ method: "POST", path: "/sessions/revoke-all", sensitive: true },
	{ method: "POST", path: "/providers/github/unlink", sensitive: true },
	{ method: "POST", path: "/providers/github/link", sensitive: true },
	{ method: "DELETE", path: "/", sensitive: true },
];

describe("bearer authentication", () => {
	it("refuses every endpoint without a token, with a JWT or a foreign token", async () => {
		const { accessToken: localman } = await localmanSignIn(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		for (const { method, path } of ENDPOINTS) {
			const label = `${method} ${path}`;
			const body = method === "GET" ? undefined : {};
			const none = await callApi(idp, path, { method, body });
			expect(none.status, label).toBe(401);
			expect(none.headers.get("www-authenticate"), label).toBe(
				'Bearer realm="account"',
			);
			expect((await none.json()).error, label).toBe("invalid_token");
			const jwt = await callApi(idp, path, {
				method,
				token: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln",
				body,
			});
			expect(jwt.status, label).toBe(401);
			// Another client's live opaque token (Localman): wrong audience.
			const foreign = await callApi(idp, path, {
				method,
				token: localman,
				body,
			});
			expect(foreign.status, label).toBe(403);
			expect(foreign.headers.get("www-authenticate"), label).toContain(
				'error="insufficient_scope"',
			);
		}
	});

	it("refuses a token without scope account, a revoked token, a foreign grant and another tenant's token", async () => {
		const app = await signedInApp(idp);
		const config = await accountIosConfig(idp);
		// The app asking for less than `account` gets a token that cannot manage.
		const narrow = await (async () => {
			const verifier = client.randomPKCECodeVerifier();
			const url = client.buildAuthorizationUrl(config, {
				redirect_uri: `${idp.issuer}/ios/callback`,
				scope: "openid profile",
				code_challenge: await client.calculatePKCECodeChallenge(verifier),
				code_challenge_method: "S256",
			});
			const start = await app.browser.navigate(
				url,
				{},
				`${idp.issuer}/ios/callback`,
			);
			const page = await start.response.text();
			const uid = /\/interaction\/([\w-]+)/.exec(start.response.url)?.[1];
			const back = await app.browser.navigate(
				`${idp.issuer}/interaction/${uid}/consent`,
				{ form: { csrf: formField(page, "csrf") } },
				`${idp.issuer}/ios/callback`,
			);
			if (!back.location) throw new Error("no code");
			return client.authorizationCodeGrant(config, back.location, {
				pkceCodeVerifier: verifier,
			});
		})();
		expect(
			(await callApi(idp, "/", { token: narrow.access_token })).status,
		).toBe(403);

		const tokens = idp.db.collection(collectionNameFor("AccessToken"));
		const { accessToken: localman } = await localmanSignIn(idp, app.account);
		const localmanGrant = (
			await idp.db
				.collection<{ _id: string }>(collectionNameFor("Grant"))
				.findOne({
					"payload.accountId": app.account._id,
					"payload.clientId": "localman-web",
				})
		)?._id;
		expect(localman).toBeTruthy();
		// A token whose grant is another client's: refused.
		const other = await signedInApp(idp);
		await tokens.updateOne(
			{ grantId: (await grantOf(other.accessToken)) ?? "" },
			{ $set: { grantId: localmanGrant, "payload.grantId": localmanGrant } },
		);
		expect((await callApi(idp, "/", { token: other.accessToken })).status).toBe(
			401,
		);

		// Another tenant's token is not this tenant's.
		const third = await signedInApp(idp);
		await tokens.updateMany(
			{ grantId: await grantOf(third.accessToken) },
			{ $set: { tenantId: "tenant-other" } },
		);
		expect((await callApi(idp, "/", { token: third.accessToken })).status).toBe(
			401,
		);

		// Revoked at /token/revocation: refused at once.
		expect((await callApi(idp, "/", { token: app.accessToken })).status).toBe(
			200,
		);
		await client.tokenRevocation(config, app.accessToken);
		expect((await callApi(idp, "/", { token: app.accessToken })).status).toBe(
			401,
		);
	});

	it("refuses a token once its device is signed out at /account on the web", async () => {
		const app = await signedInApp(idp);
		const grantId = await grantOf(app.accessToken);
		const page = await (
			await app.browser.request(`${idp.issuer}/account`)
		).text();
		const out = await app.browser.request(
			`${idp.issuer}/account/devices/${grantId}/revoke`,
			{ form: { csrf: formField(page, "csrf") } },
		);
		expect(out.headers.get("location")).toBe("/account?notice=device-revoked");
		expect((await callApi(idp, "/", { token: app.accessToken })).status).toBe(
			401,
		);
	});
});

async function grantOf(accessToken: string): Promise<string | undefined> {
	return (await idp.provider.AccessToken.find(accessToken))?.grantId;
}

describe("re-authentication of sensitive endpoints", () => {
	it("needs a fresh ID token for this client and account, once", async () => {
		const app = await signedInApp(idp, {
			google: `g-${randomUUID()}`,
			github: `gh-${randomUUID()}`,
		});
		// Linking needs a provider that is not linked yet: Google only.
		const linking = await signedInApp(idp);
		const now = Math.floor(Date.now() / 1000);
		const refusedFor = async (sub: string) => [
			undefined,
			"not-a-jwt",
			await forgeIdToken(idp, { sub, auth_time: now - 11 * 60 }),
			await forgeIdToken(idp, { sub, aud: "chat-mobile" }),
			await forgeIdToken(idp, { sub, iss: "https://evil.example" }),
			await forgeIdToken(idp, { sub: "acc_someone_else" }),
			await forgeIdToken(idp, { sub, auth_time: undefined }),
		];
		for (const { method, path } of ENDPOINTS.filter((e) => e.sensitive)) {
			const caller = path.endsWith("/link") ? linking : app;
			const refused = await refusedFor(caller.account._id);
			for (const [index, idToken] of refused.entries()) {
				const answer = await callApi(idp, path, {
					method,
					token: caller.accessToken,
					body: { id_token: idToken, username: caller.account.username },
				});
				const label = `${method} ${path} #${index}`;
				expect(answer.status, label).toBe(403);
				expect((await answer.json()).error, label).toBe("reauth_required");
			}
		}
		// The ID token of a real prompt=login sign-in works, once.
		const fresh = await appSignIn(idp, app.browser, app.account);
		const once = { id_token: fresh.id_token };
		const first = await callApi(idp, "/sessions/revoke-all", {
			method: "POST",
			token: app.accessToken,
			body: once,
		});
		expect(first.status).toBe(204);
		const again = await callApi(idp, "/sessions/revoke-all", {
			method: "POST",
			token: app.accessToken,
			body: once,
		});
		expect(again.status).toBe(403);
		expect(
			await repositoryOf(idp).findActiveById(app.account._id),
		).toBeDefined();
	});
});

describe("rate limits", () => {
	it("counts parameterised paths together, per IP and per account", async () => {
		const limited = await startTestIdp({
			interactions: "real",
			rateLimits: [],
			accountApiLimits: { perIp: 1_000, perAccount: 3, sensitivePerAccount: 1 },
		});
		try {
			const app = await signedInApp(limited);
			const statuses: number[] = [];
			for (const id of ["a", "b", "c", "d"]) {
				const answer = await callApi(limited, `/devices/${id}/revoke`, {
					method: "POST",
					token: app.accessToken,
				});
				statuses.push(answer.status);
				if (answer.status === 429) {
					expect((await answer.json()).error).toBe("rate_limited");
					expect(answer.headers.get("retry-after")).toBeTruthy();
				}
			}
			expect(statuses).toEqual([404, 404, 404, 429]);
			const other = await signedInApp(limited);
			const sensitive = [];
			for (const _ of [1, 2]) {
				sensitive.push(
					(
						await callApi(limited, "/sessions/revoke-all", {
							method: "POST",
							token: other.accessToken,
							body: {},
						})
					).status,
				);
			}
			expect(sensitive).toEqual([403, 429]);
		} finally {
			await limited.close();
		}
		const perIp = await startTestIdp({
			interactions: "real",
			rateLimits: [],
			accountApiLimits: { perIp: 2, perAccount: 100, sensitivePerAccount: 100 },
		});
		try {
			const statuses = [];
			for (const id of ["x", "y", "z"]) {
				statuses.push(
					(await callApi(perIp, `/sessions/${id}/revoke`, { method: "POST" }))
						.status,
				);
			}
			expect(statuses).toEqual([401, 401, 429]);
		} finally {
			await perIp.close();
		}
	});
});
