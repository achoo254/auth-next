import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESOURCES } from "../oidc/resources.js";
import { discoverClient } from "./helpers/flows.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const MCP_REDIRECT = "http://127.0.0.1:33419/callback";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function authorize(
	config: client.Configuration,
	redirectUri: string,
	params: Record<string, string>,
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
		...params,
	});
	return { url, checks: { pkceCodeVerifier: verifier, expectedState: state } };
}

describe("sign-up, consent and return to an MCP client", () => {
	it("creates an account, shows recovery codes once, asks consent and returns a code", async () => {
		const registered = await client.dynamicClientRegistration(
			new URL(idp.issuer),
			{
				redirect_uris: [MCP_REDIRECT],
				token_endpoint_auth_method: "none",
				client_name: "Claude Code",
				scope: "mock:read",
			},
			client.None(),
			{ execute: [client.allowInsecureRequests] },
		);
		const config = await discoverClient(
			idp,
			registered.clientMetadata().client_id,
			client.None(),
		);
		const { url, checks } = await authorize(config, MCP_REDIRECT, {
			scope: "mock:read",
			resource: RESOURCES.localmanMcp,
		});
		const browser = new TestBrowser();
		const login = await browser.navigate(url, {}, MCP_REDIRECT);
		const uid = /\/interaction\/([\w-]+)/.exec(login.response.url)?.[1] ?? "";

		const signupPage = await (
			await browser.request(`${idp.issuer}/interaction/${uid}/signup`)
		).text();
		const created = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/signup`,
			{
				csrf: formField(signupPage, "csrf"),
				email: "Minh.Anh@Example.com",
				username: "minh_anh",
				password: "1234567",
				password_confirm: "1234567",
			},
		);
		const codesPage = await created.response.text();
		expect(
			codesPage.match(/<li><code>[a-z2-9]{4}-[a-z2-9]{4}<\/code><\/li>/g),
		).toHaveLength(8);
		expect(codesPage).toContain(
			'download="hoandat-recovery-codes-minh_anh.txt"',
		);

		const csrf = formField(codesPage, "csrf");
		const unconfirmed = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/signup/done`,
			{ csrf },
		);
		expect(unconfirmed.response.status).toBe(400);
		const consent = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/signup/done`,
			{ csrf, saved: "yes" },
		);
		const consentPage = await consent.response.text();
		expect(consentPage).toContain("Ứng dụng bên thứ ba chưa xác minh");
		expect(consentPage).toContain("127.0.0.1:33419");
		expect(consentPage).toContain(
			"Xem project mock trên Localman mà bạn có quyền truy cập",
		);
		expect(consentPage).not.toContain('data-id="consent-credentials-warning"');

		const consentUid =
			/\/interaction\/([\w-]+)/.exec(consent.response.url)?.[1] ?? "";
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${consentUid}/consent`,
			{ csrf: formField(consentPage, "csrf") },
			MCP_REDIRECT,
		);
		if (!back.location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(
			config,
			back.location,
			checks,
		);
		expect(tokens.access_token).toEqual(expect.any(String));

		const account = await repositoryOf(idp).findByIdentifier(
			"minh.anh@example.com",
		);
		expect(account).toMatchObject({
			username: "minh_anh",
			emailVerifiedBy: null,
		});
		expect(account?.recoveryCodeHashes).toHaveLength(8);
	});
});

describe("logout", () => {
	it("asks on its own page, signs out, and /account then needs a login", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		await submitForm(
			page.browser,
			`${idp.issuer}/interaction/${page.uid}/login`,
			{
				csrf: page.csrf,
				identifier: account.username,
				password: TEST_PASSWORD,
			},
			LOCALMAN_CALLBACK,
		);
		const ask = await (
			await page.browser.request(`${idp.issuer}/session/end`)
		).text();
		expect(ask).toContain('id="op.logoutForm"');
		expect(ask).toContain("Đăng xuất khỏi tài khoản hoandat");
		const done = await submitForm(
			page.browser,
			`${idp.issuer}/session/end/confirm`,
			{
				xsrf: formField(ask, "xsrf"),
				logout: "yes",
			},
		);
		expect(await done.response.text()).toContain("Đã đăng xuất");
		const accountPage = await page.browser.request(`${idp.issuer}/account`);
		expect(accountPage.status).toBe(303);
		expect(accountPage.headers.get("location")).toContain(
			"client_id=hoandat-account",
		);
	});
});
