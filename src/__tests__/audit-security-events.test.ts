import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { RESOURCES } from "../oidc/resources.js";
import { codeTokens, localmanWeb } from "./helpers/exchange-flows.js";
import { cliLogin, signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const MCP_REDIRECT = "http://127.0.0.1:33420/callback";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function typesOf(sub: string): Promise<string[]> {
	return auditOutboxCollection(idp.db)
		.find({ sub })
		.sort({ occurredAt: 1 })
		.toArray()
		.then((events) => events.map((event) => event.type));
}

describe("failed sign-ins and locks", () => {
	it("records each wrong password, the lock once, and nothing while locked", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		for (let attempt = 0; attempt < 5; attempt += 1) {
			const page = await openLoginPage(idp);
			expect(
				(await postLogin(idp, page, account.username, "wrong")).status,
			).toBe(401);
		}
		const locked = await postLogin(
			idp,
			await openLoginPage(idp),
			account.username,
			"wrong",
		);
		expect(locked.status).toBe(429);
		const expected = [...Array(5).fill("login.failed"), "login.locked"];
		await expect.poll(() => typesOf(account._id)).toEqual(expected);
		// The refused attempt left nothing behind, even a moment later.
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(await typesOf(account._id)).toEqual(expected);
	});
});

describe("grants created and ended outside /account", () => {
	it("records an approved Tunelo device", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await cliLogin(idp, await signedInBrowser(idp, account));
		const [created] = await auditOutboxCollection(idp.db)
			.find({ sub: account._id, type: "grant.created" })
			.toArray();
		expect(created?.data).toMatchObject({
			clientId: "tunelo-cli",
			kind: "device",
			deviceName: expect.any(String),
		});
	});

	it("records consent to a third-party MCP client", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const config = await client.dynamicClientRegistration(
			new URL(idp.issuer),
			{
				redirect_uris: [MCP_REDIRECT],
				token_endpoint_auth_method: "none",
				client_name: "Agent",
			},
			client.None(),
			{ execute: [client.allowInsecureRequests] },
		);
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: MCP_REDIRECT,
			scope: "mock:read",
			resource: RESOURCES.localmanMcp,
			code_challenge: await client.calculatePKCECodeChallenge(
				client.randomPKCECodeVerifier(),
			),
			code_challenge_method: "S256",
		});
		const { response } = await browser.navigate(url, {}, MCP_REDIRECT);
		const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1] ?? "";
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/consent`,
			{ csrf: formField(await response.text(), "csrf") },
			MCP_REDIRECT,
		);
		expect(back.location).toBeDefined();
		const created = await auditOutboxCollection(idp.db).findOne({
			sub: account._id,
			type: "grant.created",
		});
		expect(created?.data).toEqual({
			clientId: config.clientMetadata().client_id,
			kind: "third-party-app",
		});
	});

	it("records a revocation at /token/revocation and an RP-initiated logout", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const localman = await localmanWeb(idp);
		const tokens = await codeTokens(
			localman,
			browser,
			LOCALMAN_CALLBACK,
			"openid",
		);
		// Revoking a refresh token revokes its grant (an access token alone
		// only loses its tokens, so it is not a grant revocation).
		await client.tokenRevocation(localman, String(tokens.refresh_token));
		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf: formField(ask, "xsrf"),
			logout: "yes",
		});
		await expect
			.poll(async () =>
				(
					await auditOutboxCollection(idp.db)
						.find({
							sub: account._id,
							type: /^(grant\.revoked|session\.logout)$/,
						})
						.sort({ occurredAt: 1 })
						.toArray()
				).map(({ type, data }) => ({ type, data })),
			)
			.toEqual([
				{
					type: "grant.revoked",
					data: {
						count: 1,
						cause: "token-revocation",
						clientId: "localman-web",
					},
				},
				{ type: "session.logout", data: { scope: "all" } },
			]);
	});
});
