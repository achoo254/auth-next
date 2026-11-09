import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../config/env.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { buildKbClients } from "../oidc/kb-clients.js";
import {
	PRIMARY_TENANT_ID,
	envKbClients,
	envTenant,
} from "../tenants/env-tenant.js";
import { appOfClient } from "../usage/usage-apps.js";
import { codeTokens } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import {
	KB_WEB_DEV_SECRET,
	KB_WEB_DEV_URL,
	KB_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

/**
 * Knowledge Base signs readers in through its server (BFF) with
 * `openid profile email`, keeps its own session (no refresh token) and
 * learns of IdP sign-outs by back-channel. oidc-provider refuses outgoing
 * calls to special-use addresses, so the back-channel logout is checked on
 * the IdP side, as in miu-clients-flow.test.ts.
 */
const KB_URL = "http://127.0.0.1:9";
const KB_CALLBACK = `${KB_URL}/auth/callback`;
const KB_SCOPE = "openid profile email";
const PICTURE = "https://lh3.googleusercontent.com/a/kb-picture";
const backchannel: { clientId: string; sid: unknown }[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { KB_WEB_URL: KB_URL },
	});
	const record = (...args: unknown[]): void => {
		const target = args.find(
			(arg): arg is { clientId: string } =>
				typeof arg === "object" && arg !== null && "clientId" in arg,
		);
		if (target)
			backchannel.push({ clientId: target.clientId, sid: args.at(-1) });
	};
	idp.provider.on("backchannel.success", record);
	idp.provider.on("backchannel.error", record);
});

afterAll(async () => {
	await idp?.close();
});

async function signedIn(): Promise<{
	account: TestAccount;
	browser: TestBrowser;
}> {
	const account = await createTestAccount(repositoryOf(idp), {
		emailVerifiedBy: "google",
		name: "Nguyễn Văn B",
		picture: PICTURE,
	});
	return { account, browser: await signedInBrowser(idp, account) };
}

const kbWeb = () =>
	discoverClient(
		idp,
		STATIC_CLIENT_IDS.kbWeb,
		client.ClientSecretBasic(KB_WEB_SECRET),
	);

async function signOutAtIdp(browser: TestBrowser): Promise<void> {
	const ask = await (await browser.request(`${idp.issuer}/session/end`)).text();
	await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
		xsrf: formField(ask, "xsrf"),
		logout: "yes",
	});
}

describe("kb-web", () => {
	it("is a confidential Code client for openid profile email, with back-channel logout and no resource", async () => {
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.kbWeb)
		)?.metadata();
		expect(metadata).toMatchObject({
			client_name: "Knowledge Base",
			token_endpoint_auth_method: "client_secret_basic",
			grant_types: ["authorization_code"],
			response_types: ["code"],
			redirect_uris: [KB_CALLBACK],
			post_logout_redirect_uris: [`${KB_URL}/`],
			backchannel_logout_uri: `${KB_URL}/auth/backchannel-logout`,
			backchannel_logout_session_required: true,
			scope: KB_SCOPE,
			allowed_resources: [],
		});
	});

	it("signs in with PKCE and no consent page, reads the profile from userinfo, has no refresh token, and is told of the IdP sign-out", async () => {
		const { account, browser } = await signedIn();
		const config = await kbWeb();
		const tokens = await codeTokens(config, browser, KB_CALLBACK, KB_SCOPE);
		expect(tokens.refresh_token).toBeUndefined();
		const claims = decodeJwt(tokens.id_token ?? "");
		expect(claims).toMatchObject({
			iss: idp.issuer,
			aud: STATIC_CLIENT_IDS.kbWeb,
		});
		expect(claims.sid).toEqual(expect.any(String));
		// Scope claims stay out of the ID token (conformIdTokenClaims).
		expect(claims.email).toBeUndefined();
		const profile = await client.fetchUserInfo(
			config,
			tokens.access_token,
			String(claims.sub),
		);
		expect(profile).toMatchObject({
			name: "Nguyễn Văn B",
			picture: PICTURE,
			email: account.email,
			email_verified: true,
		});

		await signOutAtIdp(browser);
		await expect
			.poll(() => backchannel, { timeout: 5000 })
			.toContainEqual({ clientId: STATIC_CLIENT_IDS.kbWeb, sid: claims.sid });
	});

	it("needs PKCE and its secret, and refuses a scope it does not have", async () => {
		const { browser } = await signedIn();
		const url = new URL(`${idp.issuer}/auth`);
		url.search = new URLSearchParams({
			client_id: STATIC_CLIENT_IDS.kbWeb,
			response_type: "code",
			scope: "openid",
			redirect_uri: KB_CALLBACK,
		}).toString();
		const { location } = await browser.navigate(url, {}, KB_CALLBACK);
		expect(location?.searchParams.get("error")).toBe("invalid_request");
		expect(location?.searchParams.get("error_description")).toMatch(/PKCE/);

		const wrong = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.kbWeb,
			client.ClientSecretBasic("w".repeat(43)),
		);
		await expect(
			codeTokens(wrong, browser, KB_CALLBACK, "openid"),
		).rejects.toMatchObject({ status: 401 });
		await expect(
			codeTokens(await kbWeb(), browser, KB_CALLBACK, `${KB_SCOPE} telegram`),
		).rejects.toMatchObject({ error: "invalid_scope" });
	});

	it("counts with kb-web-dev as the app kb in usage metrics", () => {
		expect(appOfClient(STATIC_CLIENT_IDS.kbWeb)).toBe("kb");
		expect(appOfClient(STATIC_CLIENT_IDS.kbWebDev)).toBe("kb");
	});
});

describe("kb-web-dev (local development)", () => {
	it("accepts its exact loopback redirect and has no back-channel", async () => {
		const { browser } = await signedIn();
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.kbWebDev,
			client.ClientSecretBasic(KB_WEB_DEV_SECRET),
		);
		const tokens = await codeTokens(
			config,
			browser,
			`${KB_WEB_DEV_URL}/auth/callback`,
			KB_SCOPE,
		);
		expect(tokens.id_token).toEqual(expect.any(String));
		expect(tokens.refresh_token).toBeUndefined();
		const metadata = (
			await idp.provider.Client.find(STATIC_CLIENT_IDS.kbWebDev)
		)?.metadata();
		expect(metadata?.backchannel_logout_uri).toBeUndefined();
		expect(metadata?.grant_types).toEqual(["authorization_code"]);
		// Another port of the same machine is another origin.
		const { location } = await browser.navigate(
			client.buildAuthorizationUrl(config, {
				redirect_uri: "http://localhost:5322/auth/callback",
				scope: KB_SCOPE,
				code_challenge: await client.calculatePKCECodeChallenge(
					client.randomPKCECodeVerifier(),
				),
				code_challenge_method: "S256",
			}),
			{},
			"http://localhost:5322/",
		);
		expect(location).toBeUndefined();
	});
});

describe("no mobile client", () => {
	it("has no kb-mobile", async () => {
		expect(await idp.provider.Client.find("kb-mobile")).toBeUndefined();
		expect(Object.values<string>(STATIC_CLIENT_IDS)).not.toContain("kb-mobile");
	});
});

describe("other tenants", () => {
	it("have no Knowledge Base client even with the same environment", async () => {
		const other = await startTestIdp({
			interactions: "auto",
			rateLimits: [],
			tenant: OTHER_TEST_TENANT,
		});
		try {
			for (const id of [STATIC_CLIENT_IDS.kbWeb, STATIC_CLIENT_IDS.kbWebDev]) {
				expect(await other.provider.Client.find(id), id).toBeUndefined();
			}
		} finally {
			await other.close();
		}
	});
});

describe("buildKbClients", () => {
	const web = { url: "https://kb.example", secret: "s".repeat(32) };
	const dev = { url: KB_WEB_DEV_URL, secret: "d".repeat(32) };
	const ids = (clients: { client_id: string }[]) =>
		clients.map((c) => c.client_id);

	it("builds each client only from its own pair, on the primary tenant only", () => {
		const primary = { id: PRIMARY_TENANT_ID };
		expect(buildKbClients(primary, undefined)).toEqual([]);
		expect(buildKbClients(primary, {})).toEqual([]);
		expect(ids(buildKbClients(primary, { web }))).toEqual(["kb-web"]);
		expect(ids(buildKbClients(primary, { dev }))).toEqual(["kb-web-dev"]);
		expect(ids(buildKbClients(primary, { web, dev }))).toEqual([
			"kb-web",
			"kb-web-dev",
		]);
		expect(buildKbClients({ id: OTHER_TEST_TENANT.id }, { web, dev })).toEqual(
			[],
		);
	});
});

describe("configuration", () => {
	const BASE_ENV = {
		MONGO_URL: "mongodb://127.0.0.1:27017/auth",
		SIGNING_KEYS_PATH: "unused.json",
		COOKIE_KEYS: "k".repeat(32),
		LOCALMAN_WEB_CLIENT_SECRET: "l".repeat(32),
		TUNELO_WEB_CLIENT_SECRET: "t".repeat(32),
		CHAT_WEB_CLIENT_SECRET: "c".repeat(32),
	};
	const url = "https://kb.hoandat.com";
	const secret = "s".repeat(32);
	const devUrl = "http://localhost:5321";
	const devSecret = "d".repeat(32);

	it("registers kb-web only with both KB_WEB_URL and its secret, and lists it then", () => {
		const unset = parseEnv(BASE_ENV);
		expect(envKbClients(unset)).toEqual({});
		expect(envTenant(unset).webApps.kb).toBeUndefined();
		const configured = parseEnv({
			...BASE_ENV,
			KB_WEB_URL: url,
			KB_WEB_CLIENT_SECRET: secret,
		});
		expect(envKbClients(configured)).toEqual({ web: { url, secret } });
		expect(envTenant(configured).webApps.kb).toBe(url);
		expect(() => parseEnv({ ...BASE_ENV, KB_WEB_URL: url })).toThrow(
			/KB_WEB_CLIENT_SECRET: must be set together/,
		);
		expect(() =>
			parseEnv({ ...BASE_ENV, KB_WEB_CLIENT_SECRET: secret }),
		).toThrow(/KB_WEB_URL: must be set together/);
		expect(() =>
			parseEnv({
				...BASE_ENV,
				KB_WEB_URL: url,
				KB_WEB_CLIENT_SECRET: "short",
			}),
		).toThrow(/KB_WEB_CLIENT_SECRET: must be at least 32/);
	});

	it("registers kb-web-dev only with its loopback pair, without listing Knowledge Base", () => {
		const configured = parseEnv({
			...BASE_ENV,
			KB_WEB_DEV_URL: devUrl,
			KB_WEB_DEV_CLIENT_SECRET: devSecret,
		});
		expect(envKbClients(configured)).toEqual({
			dev: { url: devUrl, secret: devSecret },
		});
		expect(envTenant(configured).webApps.kb).toBeUndefined();
		expect(() => parseEnv({ ...BASE_ENV, KB_WEB_DEV_URL: devUrl })).toThrow(
			/KB_WEB_DEV_CLIENT_SECRET: must be set together/,
		);
		expect(() =>
			parseEnv({ ...BASE_ENV, KB_WEB_DEV_CLIENT_SECRET: devSecret }),
		).toThrow(/KB_WEB_DEV_URL: must be set together/);
		expect(() =>
			parseEnv({
				...BASE_ENV,
				KB_WEB_DEV_URL: "http://10.0.0.2:5321",
				KB_WEB_DEV_CLIENT_SECRET: devSecret,
			}),
		).toThrow(/KB_WEB_DEV_URL: must be on localhost/);
	});

	it("requires a public https KB_WEB_URL in production", () => {
		for (const insecure of [
			"http://kb.hoandat.com",
			"https://localhost:3000",
		]) {
			expect(() =>
				parseEnv({
					...BASE_ENV,
					NODE_ENV: "production",
					KB_WEB_URL: insecure,
					KB_WEB_CLIENT_SECRET: secret,
				}),
			).toThrow(/KB_WEB_URL: must be a public https URL in production/);
		}
	});
});
