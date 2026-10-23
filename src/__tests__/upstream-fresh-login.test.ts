import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGithubUpstream } from "../accounts/upstream-github.js";
import { createGoogleUpstream } from "../accounts/upstream-google.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser } from "./helpers/test-browser.js";
import {
	CHAT_WEB_SECRET,
	MIU_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { linkedGoogleProfile } from "./helpers/upstream-sign-in.js";

/**
 * A Miu World client that demands a fresh authentication (prompt=login,
 * max_age=0) gets one from Google too: the IdP asks Google for prompt=login and
 * max_age=0 instead of select_account, and refuses Google's answer when its
 * auth_time is not fresh; the ID token then says so (`amr` "reauth"). GitHub
 * cannot prove it, so such a sign-in neither offers nor accepts GitHub.
 */
const MIU_URL = "http://127.0.0.1:9";
const MIU_CALLBACK = `${MIU_URL}/api/auth/callback`;
const CHAT_URL = "http://127.0.0.1:10";
const CHAT_CALLBACK = `${CHAT_URL}/auth/callback`;
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { MIU_WEB_URL: MIU_URL, CHAT_WEB_URL: CHAT_URL },
	});
});

afterAll(async () => {
	await idp?.close();
});

const checks = (freshLogin: boolean) => ({
	state: "s".repeat(43),
	codeVerifier: "v".repeat(43),
	nonce: "n".repeat(22),
	freshLogin,
});
const credentials = { clientId: "id", clientSecret: "secret" };

describe("upstream authorization parameters", () => {
	it("asks Google to sign in again only for a fresh authentication", async () => {
		const google = createGoogleUpstream(credentials, "https://auth.test/cb");
		const plain = (await google.authorizationUrl(checks(false))).searchParams;
		expect(plain.get("prompt")).toBe("select_account");
		expect(plain.has("max_age")).toBe(false);
		const fresh = (await google.authorizationUrl(checks(true))).searchParams;
		expect(fresh.get("prompt")).toBe("login");
		expect(fresh.get("max_age")).toBe("0");
		// Google sends auth_time only when asked for as an essential claim.
		expect(JSON.parse(fresh.get("claims") ?? "{}")).toEqual({
			id_token: { auth_time: { essential: true } },
		});
		expect(plain.has("claims")).toBe(false);
	});

	it("sends GitHub no prompt either way (it has none that forces credentials)", async () => {
		const github = createGithubUpstream(credentials, "https://auth.test/cb");
		for (const fresh of [false, true]) {
			const q = (await github.authorizationUrl(checks(fresh))).searchParams;
			expect(q.has("prompt")).toBe(false);
			expect(q.has("max_age")).toBe(false);
		}
	});
});

const CLIENTS = {
	miu: {
		id: STATIC_CLIENT_IDS.miuWeb,
		secret: MIU_WEB_SECRET,
		callback: MIU_CALLBACK,
	},
	chat: {
		id: STATIC_CLIENT_IDS.chatWeb,
		secret: CHAT_WEB_SECRET,
		callback: CHAT_CALLBACK,
	},
} as const;
type ClientName = keyof typeof CLIENTS;

/** A client's authorization request, up to the IdP sign-in page. */
async function signInPage(
	browser: TestBrowser,
	extra: Record<string, string>,
	name: ClientName = "miu",
) {
	const app = CLIENTS[name];
	const config = await discoverClient(
		idp,
		app.id,
		client.ClientSecretBasic(app.secret),
	);
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const nonce = client.randomNonce();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: app.callback,
		scope: "openid email",
		state,
		nonce,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		...extra,
	});
	const { response } = await browser.navigate(url, {}, app.callback);
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
	return { uid, html, redeem, callback: app.callback };
}

async function viaGoogle(
	browser: TestBrowser,
	account: TestAccount,
	page: { uid: string; callback: string },
	authTime?: number,
) {
	idp.fake.nextLogins.push({ ...linkedGoogleProfile(account), authTime });
	const result = await browser.navigate(
		`${idp.issuer}/interaction/${page.uid}/upstream/google`,
		{},
		page.callback,
	);
	return { ...result, authorize: idp.fake.authorizeRequests.at(-1) };
}

const googleParent = () =>
	createTestAccount(repositoryOf(idp), { emailVerifiedBy: "google" });
const nowS = () => Math.floor(Date.now() / 1000);

describe("fresh authentication through Google (Miu World)", () => {
	it("forwards prompt=login, max_age=0 and the auth_time claim to Google and says so in amr", async () => {
		const account = await googleParent();
		const browser = await signedInBrowser(idp, account);
		const page = await signInPage(browser, { prompt: "login", max_age: "0" });
		const { location, authorize } = await viaGoogle(
			browser,
			account,
			page,
			nowS(),
		);
		expect(authorize?.searchParams.get("prompt")).toBe("login");
		expect(authorize?.searchParams.get("max_age")).toBe("0");
		expect(authorize?.searchParams.get("claims")).toContain("auth_time");
		if (!location) throw new Error("did not return to Miu");
		const claims = await page.redeem(location);
		expect(claims.amr).toEqual(["fed", "google", "reauth"]);
		expect(claims.auth_time).toBeGreaterThan(nowS() - 60);
	});

	it.each([
		["a stale auth_time", nowS() - 3600],
		["no auth_time", undefined],
	])(
		"fails closed on %s: signed in, but no reauth in amr",
		async (_name, authTime) => {
			const account = await googleParent();
			const browser = await signedInBrowser(idp, account);
			const page = await signInPage(browser, { prompt: "login", max_age: "0" });
			const { location } = await viaGoogle(browser, account, page, authTime);
			if (!location) throw new Error("did not return to Miu");
			expect((await page.redeem(location)).amr).toEqual(["fed", "google"]);
		},
	);

	it("neither offers nor accepts GitHub when the sign-in must be fresh", async () => {
		const browser = await signedInBrowser(idp, await googleParent());
		const fresh = await signInPage(browser, { prompt: "login" });
		expect(fresh.html).toContain("upstream-google");
		expect(fresh.html).not.toContain("upstream-github");
		const github = await browser.request(
			`${idp.issuer}/interaction/${fresh.uid}/upstream/github`,
		);
		expect(github.status).toBe(404);
		const plain = await signInPage(new TestBrowser(), {});
		expect(plain.html).toContain("upstream-github");
	});

	it("keeps select_account and no reauth for an ordinary Miu sign-in", async () => {
		const account = await googleParent();
		const browser = new TestBrowser();
		const page = await signInPage(browser, {});
		const { authorize, location } = await viaGoogle(browser, account, page);
		expect(authorize?.searchParams.get("prompt")).toBe("select_account");
		expect(authorize?.searchParams.has("max_age")).toBe(false);
		if (!location) throw new Error("did not return to Miu");
		expect((await page.redeem(location)).amr).toEqual(["fed", "google"]);
	});
});

describe("other clients keep the ordinary upstream sign-in", () => {
	it.each([
		["prompt=login", { prompt: "login" }],
		["max_age=0", { max_age: "0" }],
		["max_age=600 (Chat), signed out", { max_age: "600" }],
	])(
		"Chat with %s still offers GitHub and asks Google with select_account",
		async (_name, extra: Record<string, string>) => {
			const account = await googleParent();
			const browser = new TestBrowser();
			const page = await signInPage(browser, extra, "chat");
			expect(page.html).toContain("upstream-github");
			const github = await browser.request(
				`${idp.issuer}/interaction/${page.uid}/upstream/github`,
			);
			expect(github.status).toBe(303);
			const { authorize, location } = await viaGoogle(
				browser,
				account,
				page,
				nowS() - 3600,
			);
			expect(authorize?.searchParams.get("prompt")).toBe("select_account");
			expect(authorize?.searchParams.has("max_age")).toBe(false);
			expect(authorize?.searchParams.has("claims")).toBe(false);
			// A stale Google session is no reason to refuse here.
			expect(location?.searchParams.get("code")).toBeTruthy();
		},
	);
});
