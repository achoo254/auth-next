import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { buildSignInOnlyClients } from "../oidc/sign-in-only-clients.js";
import {
	PRIMARY_TENANT_ID,
	envSignInOnlyApps,
	envTenant,
} from "../tenants/env-tenant.js";
import { appOfClient } from "../usage/usage-apps.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import type { TestAccount } from "./helpers/test-accounts.js";
import type { TestBrowser } from "./helpers/test-browser.js";
import {
	CLIP_WEB_SECRET,
	CLIP_WEB_URL,
	TIEUDE_WEB_SECRET,
	TIEUDE_WEB_URL,
	TUVI_WEB_SECRET,
	TUVI_WEB_URL,
	type TestIdp,
	WEBNHANH_WEB_SECRET,
	WEBNHANH_WEB_URL,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

/** Tử Vi, Clip and Web Nhanh show the account in their header; Tiểu Đệ does not. */
const PROFILE_SCOPE = "openid profile email";

/**
 * Tiểu Đệ, Tử Vi, Clip and Web Nhanh sign visitors in to learn they have an
 * account: a confidential web client, no refresh token, no API resource.
 * Tiểu Đệ asks for `openid` alone; the others also for the name, picture
 * and email of their account menu.
 */
const APPS = [
	{
		app: "tieude",
		scope: "openid",
		name: "Tiểu Đệ",
		clientId: STATIC_CLIENT_IDS.tieudeWeb,
		url: TIEUDE_WEB_URL,
		secret: TIEUDE_WEB_SECRET,
		env: "TIEUDE",
	},
	{
		app: "tuvi",
		scope: PROFILE_SCOPE,
		name: "Tử Vi",
		clientId: STATIC_CLIENT_IDS.tuviWeb,
		url: TUVI_WEB_URL,
		secret: TUVI_WEB_SECRET,
		env: "TUVI",
	},
	{
		app: "clip",
		scope: PROFILE_SCOPE,
		name: "Clip",
		clientId: STATIC_CLIENT_IDS.clipWeb,
		url: CLIP_WEB_URL,
		secret: CLIP_WEB_SECRET,
		env: "CLIP",
	},
	{
		app: "webnhanh",
		scope: PROFILE_SCOPE,
		name: "Web Nhanh",
		clientId: STATIC_CLIENT_IDS.webnhanhWeb,
		url: WEBNHANH_WEB_URL,
		secret: WEBNHANH_WEB_SECRET,
		env: "WEBNHANH",
	},
] as const;

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

const PICTURE = "https://lh3.googleusercontent.com/a/test-picture";

async function signedInAs(): Promise<{
	browser: TestBrowser;
	account: TestAccount;
}> {
	const account = await createTestAccount(repositoryOf(idp), {
		emailVerifiedBy: "google",
		name: "Nguyễn Văn A",
		picture: PICTURE,
	});
	return { browser: await signedInBrowser(idp, account), account };
}

async function signedIn(): Promise<TestBrowser> {
	return (await signedInAs()).browser;
}

describe.each(APPS)(
	"$clientId",
	({ app, name, clientId, url, secret, scope }) => {
		const callback = `${url}/auth/callback`;
		const webClient = () =>
			discoverClient(idp, clientId, client.ClientSecretBasic(secret));

		it("is a confidential Code + PKCE client for its scope, without refresh, resource or back-channel", async () => {
			const metadata = (await idp.provider.Client.find(clientId))?.metadata();
			expect(metadata).toMatchObject({
				client_name: name,
				token_endpoint_auth_method: "client_secret_basic",
				grant_types: ["authorization_code"],
				response_types: ["code"],
				redirect_uris: [callback],
				post_logout_redirect_uris: [`${url}/`],
				scope,
				allowed_resources: [],
			});
			expect(metadata?.backchannel_logout_uri).toBeUndefined();
		});

		it("signs in without a consent page, with no refresh token and no scope claim in the ID token", async () => {
			const browser = await signedIn();
			const tokens = await codeTokens(
				await webClient(),
				browser,
				callback,
				scope,
			);
			expect(tokens.refresh_token).toBeUndefined();
			const claims = decodeJwt(tokens.id_token ?? "");
			expect(claims).toMatchObject({ iss: idp.issuer, aud: clientId });
			expect(claims.sub).toEqual(expect.any(String));
			// Scope claims stay out of the ID token (conformIdTokenClaims).
			expect(claims.email).toBeUndefined();
			expect(claims.name).toBeUndefined();
		});

		it("refuses a scope it does not have", async () => {
			const browser = await signedIn();
			const extra = scope === "openid" ? "openid email" : `${scope} telegram`;
			await expect(
				codeTokens(await webClient(), browser, callback, extra),
			).rejects.toMatchObject({ error: "invalid_scope" });
		});

		it("needs its secret", async () => {
			const browser = await signedIn();
			const wrong = await discoverClient(
				idp,
				clientId,
				client.ClientSecretBasic("w".repeat(43)),
			);
			await expect(
				codeTokens(wrong, browser, callback, "openid"),
			).rejects.toMatchObject({ status: 401 });
		});

		it(`counts as the app ${app} in usage metrics`, () => {
			expect(appOfClient(clientId)).toBe(app);
		});
	},
);

const PROFILE_APPS = APPS.filter((entry) => entry.scope === PROFILE_SCOPE);

describe.each(PROFILE_APPS)(
	"account menu of $clientId",
	({ clientId, url, secret }) => {
		const callback = `${url}/auth/callback`;
		const webClient = () =>
			discoverClient(idp, clientId, client.ClientSecretBasic(secret));

		it("reads the name, picture and email from userinfo", async () => {
			const { browser, account } = await signedInAs();
			const config = await webClient();
			const tokens = await codeTokens(config, browser, callback, PROFILE_SCOPE);
			const sub = String(decodeJwt(tokens.id_token ?? "").sub);
			const profile = await client.fetchUserInfo(
				config,
				tokens.access_token,
				sub,
			);
			expect(profile).toMatchObject({
				sub,
				name: "Nguyễn Văn A",
				picture: PICTURE,
				email: account.email,
				email_verified: true,
			});
		});

		it("widens an earlier openid-only grant with no consent page", async () => {
			const browser = await signedIn();
			const config = await webClient();
			await codeTokens(config, browser, callback, "openid");
			const tokens = await codeTokens(config, browser, callback, PROFILE_SCOPE);
			expect(tokens.scope?.split(" ").sort()).toEqual([
				"email",
				"openid",
				"profile",
			]);
		});
	},
);

describe.each(APPS)("configuration of $clientId", ({ app, url, env }) => {
	const urlKey = `${env}_WEB_URL`;
	const secretKey = `${env}_WEB_CLIENT_SECRET`;
	const secret = "s".repeat(32);

	it(`registers the client only with both ${urlKey} and its secret`, () => {
		expect(envSignInOnlyApps(parseEnv(BASE_ENV))).toEqual({});
		const configured = parseEnv({
			...BASE_ENV,
			[urlKey]: url,
			[secretKey]: secret,
		});
		expect(envSignInOnlyApps(configured)).toEqual({ [app]: { url, secret } });
		expect(envTenant(configured).webApps).toMatchObject({ [app]: url });
		expect(() => parseEnv({ ...BASE_ENV, [urlKey]: url })).toThrow(
			new RegExp(`${secretKey}: must be set together`),
		);
		expect(() => parseEnv({ ...BASE_ENV, [secretKey]: secret })).toThrow(
			new RegExp(`${urlKey}: must be set together`),
		);
		expect(() =>
			parseEnv({ ...BASE_ENV, [urlKey]: url, [secretKey]: "short" }),
		).toThrow(new RegExp(`${secretKey}: must be at least 32`));
	});

	it("requires a public https URL in production", () => {
		expect(() =>
			parseEnv({
				...BASE_ENV,
				NODE_ENV: "production",
				[urlKey]: "http://localhost:3000",
				[secretKey]: secret,
			}),
		).toThrow(
			new RegExp(`${urlKey}: must be a public https URL in production`),
		);
	});
});

describe("buildSignInOnlyClients", () => {
	it("builds nothing when not configured or for another tenant", () => {
		const config = { url: TUVI_WEB_URL, secret: "s".repeat(32) };
		const primary = { id: PRIMARY_TENANT_ID };
		const other = { id: OTHER_TEST_TENANT.id };
		expect(buildSignInOnlyClients(primary, {})).toEqual([]);
		expect(buildSignInOnlyClients(other, { tuvi: config })).toEqual([]);
		const ids = buildSignInOnlyClients(primary, { tuvi: config }).map(
			(c) => c.client_id,
		);
		expect(ids).toEqual(["tuvi-web"]);
	});

	it("is absent from other tenants even with the same environment", async () => {
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			for (const { clientId } of APPS) {
				expect(await other.provider.Client.find(clientId)).toBeUndefined();
			}
		} finally {
			await other.close();
		}
	});
});
