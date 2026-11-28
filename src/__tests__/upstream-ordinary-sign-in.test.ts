import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGithubUpstream } from "../accounts/upstream-github.js";
import { createGoogleUpstream } from "../accounts/upstream-google.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { discoverClient } from "./helpers/flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser } from "./helpers/test-browser.js";
import {
	CHAT_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { linkedGoogleProfile } from "./helpers/upstream-sign-in.js";

/**
 * Every client gets the same upstream sign-in, whatever it asks of the IdP
 * (prompt=login, max_age): Google with select_account, GitHub offered, no
 * upstream auth_time check, and an ID token whose `amr` names the provider.
 */
const CHAT_URL = "http://127.0.0.1:10";
const CHAT_CALLBACK = `${CHAT_URL}/auth/callback`;
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { CHAT_WEB_URL: CHAT_URL },
	});
});

afterAll(async () => {
	await idp?.close();
});

const checks = {
	state: "s".repeat(43),
	codeVerifier: "v".repeat(43),
	nonce: "n".repeat(22),
};
const credentials = { clientId: "id", clientSecret: "secret" };

describe("upstream authorization parameters", () => {
	it("asks Google to choose an account, never to sign in again", async () => {
		const google = createGoogleUpstream(credentials, "https://auth.test/cb");
		const params = (await google.authorizationUrl(checks)).searchParams;
		expect(params.get("prompt")).toBe("select_account");
		expect(params.has("max_age")).toBe(false);
		expect(params.has("claims")).toBe(false);
	});

	it("sends GitHub no prompt", async () => {
		const github = createGithubUpstream(credentials, "https://auth.test/cb");
		const params = (await github.authorizationUrl(checks)).searchParams;
		expect(params.has("prompt")).toBe(false);
		expect(params.has("max_age")).toBe(false);
	});
});

/** Chat's authorization request, up to the IdP sign-in page. */
async function signInPage(browser: TestBrowser, extra: Record<string, string>) {
	const config = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.chatWeb,
		client.ClientSecretBasic(CHAT_WEB_SECRET),
	);
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const nonce = client.randomNonce();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: CHAT_CALLBACK,
		scope: "openid email",
		state,
		nonce,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...extra,
	});
	const { response } = await browser.navigate(url, {}, CHAT_CALLBACK);
	const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1];
	if (!uid) throw new Error(`no sign-in page: ${response.status}`);
	const html = await response.text();
	const redeem = async (location: URL) =>
		decodeJwt(
			(
				await client.authorizationCodeGrant(config, location, {
					pkceCodeVerifier: verifier,
					expectedState: state,
					expectedNonce: nonce,
				})
			).id_token ?? "",
		);
	return { uid, html, redeem };
}

async function viaGoogle(
	browser: TestBrowser,
	account: TestAccount,
	uid: string,
	authTime: number,
) {
	idp.fake.nextLogins.push({ ...linkedGoogleProfile(account), authTime });
	const result = await browser.navigate(
		`${idp.issuer}/interaction/${uid}/upstream/google`,
		{},
		CHAT_CALLBACK,
	);
	return { ...result, authorize: idp.fake.authorizeRequests.at(-1) };
}

const googleAccount = () =>
	createTestAccount(repositoryOf(idp), { emailVerifiedBy: "google" });
const nowS = () => Math.floor(Date.now() / 1000);

describe("clients keep the ordinary upstream sign-in", () => {
	it.each([
		["prompt=login", { prompt: "login" }],
		["max_age=0", { max_age: "0" }],
		["max_age=600 (Chat), signed out", { max_age: "600" }],
	])(
		"Chat with %s still offers GitHub and asks Google with select_account",
		async (_name, extra: Record<string, string>) => {
			const account = await googleAccount();
			const browser = new TestBrowser();
			const page = await signInPage(browser, extra);
			expect(page.html).toContain("upstream-github");
			const github = await browser.request(
				`${idp.issuer}/interaction/${page.uid}/upstream/github`,
			);
			expect(github.status).toBe(303);
			const { authorize, location } = await viaGoogle(
				browser,
				account,
				page.uid,
				nowS() - 3600,
			);
			expect(authorize?.searchParams.get("prompt")).toBe("select_account");
			expect(authorize?.searchParams.has("max_age")).toBe(false);
			expect(authorize?.searchParams.has("claims")).toBe(false);
			// A stale Google session is no reason to refuse here.
			if (!location) throw new Error("did not return to Chat");
			expect(location.searchParams.get("code")).toBeTruthy();
			expect((await page.redeem(location)).amr).toEqual(["fed", "google"]);
		},
	);
});
