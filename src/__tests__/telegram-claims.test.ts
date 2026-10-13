import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import {
	TUNELO_CALLBACK,
	codeTokens,
	localmanWeb,
	tuneloWeb,
} from "./helpers/exchange-flows.js";
import { authorizationRedirect, discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";

/** Chat ids are unique per account; each test links its own. */
let nextChat = 424_242_000;
const MCP_REDIRECT = "http://127.0.0.1:33421/callback";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function linkedAccount(): Promise<{
	account: TestAccount;
	chatId: string;
}> {
	const account = await createTestAccount(repositoryOf(idp));
	nextChat += 1;
	const chatId = String(nextChat);
	await repositoryOf(idp).links.setTelegram(account._id, {
		chatId,
		username: "dat_tg",
		name: "Đạt",
	});
	return { account, chatId };
}

/** Localman signs `account` in with `scope`; returns its tokens and userinfo. */
async function localmanSession(
	account: TestAccount,
	scope: string,
	extra: Record<string, string> = {},
) {
	const config = await localmanWeb(idp);
	const browser = await signedInBrowser(idp, account);
	const tokens = await codeTokens(
		config,
		browser,
		LOCALMAN_CALLBACK,
		scope,
		extra,
	);
	const userinfo = await client.fetchUserInfo(
		config,
		tokens.access_token,
		account._id,
	);
	return { tokens, userinfo };
}

describe("telegram scope for localman-web", () => {
	it("releases the linked chat at userinfo only", async () => {
		const { account, chatId } = await linkedAccount();
		const { tokens, userinfo } = await localmanSession(
			account,
			"openid profile telegram",
			// Even asked for explicitly, the chat never enters the ID token.
			{ claims: JSON.stringify({ id_token: { telegram_chat_id: null } }) },
		);
		expect(userinfo).toMatchObject({
			sub: account._id,
			telegram_linked: true,
			telegram_chat_id: chatId,
			telegram_username: "dat_tg",
		});
		expect(tokens.id_token).toBeDefined();
		expect(JSON.stringify(decodeJwt(String(tokens.id_token)))).not.toContain(
			chatId,
		);
	});

	it("keeps the chat out of JWT access tokens", async () => {
		const { account, chatId } = await linkedAccount();
		// A JWT for the Localman API (not usable at userinfo by design).
		const tokens = await codeTokens(
			await localmanWeb(idp),
			await signedInBrowser(idp, account),
			LOCALMAN_CALLBACK,
			"openid telegram mock:read",
			{ resource: RESOURCES.localman },
		);
		expect(tokens.access_token.split(".")).toHaveLength(3);
		expect(JSON.stringify(decodeJwt(tokens.access_token))).not.toContain(
			chatId,
		);
	});

	it("releases nothing without the scope or without a linked chat", async () => {
		const { account: linked } = await linkedAccount();
		const noScope = await localmanSession(linked, "openid profile");
		expect(noScope.userinfo.telegram_chat_id).toBeUndefined();
		expect(noScope.userinfo.telegram_linked).toBe(true);

		const unlinked = await createTestAccount(repositoryOf(idp));
		const { userinfo } = await localmanSession(
			unlinked,
			"openid profile telegram",
		);
		expect(userinfo.telegram_linked).toBe(false);
		expect(userinfo).not.toHaveProperty("telegram_chat_id");
		expect(userinfo).not.toHaveProperty("telegram_username");
	});
});

describe("telegram scope for anyone else", () => {
	it("is invalid_scope for tunelo-web and hoandat-account", async () => {
		const tunelo = await authorizationRedirect(
			await tuneloWeb(idp),
			TUNELO_CALLBACK,
			{ scope: "openid telegram" },
		);
		expect(tunelo.searchParams.get("error")).toBe("invalid_scope");

		const portalCallback = `${idp.issuer}/account/callback`;
		const portal = await authorizationRedirect(
			await discoverClient(idp, STATIC_CLIENT_IDS.accountPortal, client.None()),
			portalCallback,
			{ scope: "openid telegram" },
		);
		expect(portal.searchParams.get("error")).toBe("invalid_scope");
	});

	it("is invalid_scope for the Tunelo CLI device flow", async () => {
		const cli = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tuneloCli,
			client.None(),
		);
		await expect(
			client.initiateDeviceAuthorization(cli, { scope: "openid telegram" }),
		).rejects.toMatchObject({ error: "invalid_scope" });
	});

	it("cannot be registered or requested by an MCP client", async () => {
		const register = (scope?: string) =>
			client.dynamicClientRegistration(
				new URL(idp.issuer),
				{
					redirect_uris: [MCP_REDIRECT],
					token_endpoint_auth_method: "none",
					...(scope ? { scope } : {}),
				},
				client.None(),
				{ execute: [client.allowInsecureRequests] },
			);
		await expect(register("mock:read telegram")).rejects.toMatchObject({
			error: "invalid_client_metadata",
		});
		const mcp = await register();
		const location = await authorizationRedirect(mcp, MCP_REDIRECT, {
			scope: "mock:read telegram",
			resource: RESOURCES.localmanMcp,
		});
		expect(location.searchParams.get("error")).toBe("invalid_scope");
	});
});
