import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { buildTieudeClients } from "../oidc/tieude-client.js";
import { PRIMARY_TENANT_ID, envTieudeClient } from "../tenants/env-tenant.js";
import { appOfClient } from "../usage/usage-apps.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import type { TestBrowser } from "./helpers/test-browser.js";
import {
	TIEUDE_WEB_SECRET,
	TIEUDE_WEB_URL,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

/**
 * Tiểu Đệ signs visitors in only to learn they have an account: `openid`
 * alone, a confidential web client, no refresh token, no API resource.
 */
const CALLBACK = `${TIEUDE_WEB_URL}/auth/callback`;
const BASE_ENV = {
	MONGO_URL: "mongodb://127.0.0.1:27017/auth",
	SIGNING_KEYS_PATH: "unused.json",
	COOKIE_KEYS: "k".repeat(32),
	LOCALMAN_WEB_CLIENT_SECRET: "l".repeat(32),
	TUNELO_WEB_CLIENT_SECRET: "t".repeat(32),
	CHAT_WEB_CLIENT_SECRET: "c".repeat(32),
};
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function signedIn(): Promise<TestBrowser> {
	const account = await createTestAccount(repositoryOf(idp), {
		emailVerifiedBy: "google",
	});
	return signedInBrowser(idp, account);
}

const tieudeWeb = () =>
	discoverClient(
		idp,
		STATIC_CLIENT_IDS.tieudeWeb,
		client.ClientSecretBasic(TIEUDE_WEB_SECRET),
	);

describe("tieude-web", () => {
	it("is a confidential Code + PKCE client for openid only, without refresh, resource or back-channel", async () => {
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.tieudeWeb)
		)?.metadata();
		expect(metadata).toMatchObject({
			client_name: "Tiểu Đệ",
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			redirect_uris: [CALLBACK],
			post_logout_redirect_uris: [`${TIEUDE_WEB_URL}/`],
			scope: "openid",
			allowed_resources: [],
		});
		expect(metadata?.backchannel_logout_uri).toBeUndefined();
	});

	it("signs in without a consent page and returns only an ID token for the account", async () => {
		const browser = await signedIn();
		const tokens = await codeTokens(
			await tieudeWeb(),
			browser,
			CALLBACK,
			"openid",
		);
		expect(tokens.refresh_token).toBeUndefined();
		const claims = decodeJwt(tokens.id_token ?? "");
		expect(claims).toMatchObject({
			iss: idp.issuer,
			aud: STATIC_CLIENT_IDS.tieudeWeb,
		});
		expect(claims.sub).toEqual(expect.any(String));
		expect(claims.email).toBeUndefined();
	});

	it("refuses a request for more than openid", async () => {
		const browser = await signedIn();
		await expect(
			codeTokens(await tieudeWeb(), browser, CALLBACK, "openid email"),
		).rejects.toMatchObject({ error: "invalid_scope" });
	});

	it("needs its secret", async () => {
		const browser = await signedIn();
		const wrong = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tieudeWeb,
			client.ClientSecretBasic("w".repeat(43)),
		);
		await expect(
			codeTokens(wrong, browser, CALLBACK, "openid"),
		).rejects.toMatchObject({ status: 401 });
	});

	it("counts as the app tieude in usage metrics", () => {
		expect(appOfClient(STATIC_CLIENT_IDS.tieudeWeb)).toBe("tieude");
	});
});

describe("configuration", () => {
	it("registers the client only with both TIEUDE_WEB_URL and its secret", () => {
		const secret = "s".repeat(32);
		expect(envTieudeClient(parseEnv(BASE_ENV))).toBeUndefined();
		expect(
			envTieudeClient(
				parseEnv({
					...BASE_ENV,
					TIEUDE_WEB_URL,
					TIEUDE_WEB_CLIENT_SECRET: secret,
				}),
			),
		).toEqual({ url: TIEUDE_WEB_URL, secret });
		expect(() => parseEnv({ ...BASE_ENV, TIEUDE_WEB_URL })).toThrow(
			/TIEUDE_WEB_CLIENT_SECRET: must be set together/,
		);
		expect(() =>
			parseEnv({ ...BASE_ENV, TIEUDE_WEB_CLIENT_SECRET: secret }),
		).toThrow(/TIEUDE_WEB_URL: must be set together/);
		expect(() =>
			parseEnv({
				...BASE_ENV,
				TIEUDE_WEB_URL,
				TIEUDE_WEB_CLIENT_SECRET: "short",
			}),
		).toThrow(/TIEUDE_WEB_CLIENT_SECRET: must be at least 32/);
	});

	it("requires a public https URL in production", () => {
		expect(() =>
			parseEnv({
				...BASE_ENV,
				NODE_ENV: "production",
				TIEUDE_WEB_URL: "http://localhost:3000",
				TIEUDE_WEB_CLIENT_SECRET: "s".repeat(32),
			}),
		).toThrow(/TIEUDE_WEB_URL: must be a public https URL in production/);
	});

	it("builds nothing when not configured or for another tenant", () => {
		const config = { url: TIEUDE_WEB_URL, secret: "s".repeat(32) };
		const primary = { id: PRIMARY_TENANT_ID };
		const other = { id: OTHER_TEST_TENANT.id };
		expect(buildTieudeClients(primary, undefined)).toEqual([]);
		expect(buildTieudeClients(other, config)).toEqual([]);
		const ids = buildTieudeClients(primary, config).map((c) => c.client_id);
		expect(ids).toEqual(["tieude-web"]);
	});

	it("is absent from other tenants even with the same environment", async () => {
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			expect(
				await other.provider.Client.find(STATIC_CLIENT_IDS.tieudeWeb),
			).toBeUndefined();
		} finally {
			await other.close();
		}
	});
});
