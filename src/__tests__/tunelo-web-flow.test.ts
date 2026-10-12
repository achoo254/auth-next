import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { codeTokens, tuneloWeb } from "./helpers/exchange-flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

/** What the Tunelo web console asks for (its sign-in route). */
const TUNELO_WEB_SCOPE = "openid profile";

/**
 * oidc-provider refuses outgoing calls to special-use addresses (its SSRF
 * guard), so tests cannot receive the logout POST on loopback. They check
 * the IdP side of the contract instead: which client and session the
 * provider delivered (or tried to deliver) a back-channel logout for.
 */
const TUNELO_URL = "http://127.0.0.1:9";
const backchannel: { clientId: string; sid: unknown }[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { TUNELO_WEB_URL: TUNELO_URL },
	});
	const record = (...args: unknown[]): void => {
		const target = args.find(
			(arg): arg is { clientId: string } =>
				typeof arg === "object" && arg !== null && "clientId" in arg,
		);
		// (ctx, [error,] client, accountId, sid): the session id comes last.
		if (target)
			backchannel.push({ clientId: target.clientId, sid: args.at(-1) });
	};
	idp.provider.on("backchannel.success", record);
	idp.provider.on("backchannel.error", record);
});

afterAll(async () => {
	await idp?.close();
});

async function signInToTuneloWeb() {
	const account = await createTestAccount(repositoryOf(idp));
	const browser = await signedInBrowser(idp, account);
	const config = await tuneloWeb(idp);
	// codeTokens fails if a consent page stops the redirect: first-party.
	const tokens = await codeTokens(
		config,
		browser,
		`${TUNELO_URL}/auth/callback`,
		TUNELO_WEB_SCOPE,
		{},
	);
	return { browser, config, tokens };
}

describe("tunelo-web (Tunelo web console)", () => {
	it("signs in without a consent page, with a session-bound refresh token and the user's name at userinfo", async () => {
		const { config, tokens } = await signInToTuneloWeb();
		expect(tokens.refresh_token).toEqual(expect.any(String));
		expect(tokens.id_token).toEqual(expect.any(String));
		// No resource and no API scope: an opaque token, good for userinfo only.
		expect(tokens.access_token.split(".")).toHaveLength(1);
		const sub = decodeJwt(tokens.id_token ?? "").sub ?? "";
		const userinfo = await client.fetchUserInfo(
			config,
			tokens.access_token,
			sub,
		);
		expect(userinfo.preferred_username).toEqual(expect.any(String));
		expect(userinfo).not.toHaveProperty("telegram_chat_id");
	});

	it("rotates the refresh token", async () => {
		const { config, tokens } = await signInToTuneloWeb();
		const first = tokens.refresh_token;
		if (!first) throw new Error("no refresh token for tunelo-web");
		const refreshed = await client.refreshTokenGrant(config, first);
		expect(refreshed.refresh_token).toEqual(expect.any(String));
		expect(refreshed.refresh_token).not.toBe(first);
	});

	it("ends Tunelo's refresh and logs it out over the back channel when the IdP session ends", async () => {
		const { browser, config, tokens } = await signInToTuneloWeb();
		const refreshToken = tokens.refresh_token;
		if (!refreshToken) throw new Error("no refresh token for tunelo-web");
		const sid = decodeJwt(tokens.id_token ?? "").sid;
		expect(sid).toEqual(expect.any(String));

		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf: formField(ask, "xsrf"),
			logout: "yes",
		});
		await expect
			.poll(() => backchannel, { timeout: 5000 })
			.toContainEqual({ clientId: STATIC_CLIENT_IDS.tuneloWeb, sid });
		// Bound to the IdP session: even if the back channel were lost, the
		// console's next refresh fails and its session ends.
		await expect(
			client.refreshTokenGrant(config, refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});
});
