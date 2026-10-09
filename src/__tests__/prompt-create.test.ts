import { randomUUID } from "node:crypto";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RESOURCES } from "../oidc/resources.js";
import { localmanWeb } from "./helpers/exchange-flows.js";
import { discoverClient } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const MCP_REDIRECT = "http://127.0.0.1:33422/callback";
const SIGNUP_TITLE = "Tạo tài khoản hoandat";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

/** Starts an authorization in `browser`; returns where it landed and the checks. */
async function authorize(
	browser: TestBrowser,
	config: client.Configuration,
	redirectUri: string,
	parameters: Record<string, string>,
) {
	const verifier = client.randomPKCECodeVerifier();
	const state = client.randomState();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: redirectUri,
		code_challenge: await client.calculatePKCECodeChallenge(verifier),
		code_challenge_method: "S256",
		state,
		...parameters,
	});
	const landed = await browser.navigate(url, {}, redirectUri);
	const uid = /\/interaction\/([\w-]+)/.exec(landed.response.url)?.[1] ?? "";
	return {
		...landed,
		uid,
		checks: { pkceCodeVerifier: verifier, expectedState: state },
	};
}

/** Fills the sign-up form and confirms the recovery codes were saved. */
async function signUp(browser: TestBrowser, uid: string, page: string) {
	const name = `new_${randomUUID().slice(0, 8)}`;
	const codes = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/signup`,
		{
			csrf: formField(page, "csrf"),
			email: `${name}@example.com`,
			username: name,
			password: "1234567",
			password_confirm: "1234567",
		},
	);
	const done = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/signup/done`,
		{ csrf: formField(await codes.response.text(), "csrf"), saved: "yes" },
		LOCALMAN_CALLBACK,
	);
	return { name, location: done.location };
}

describe("prompt=create (OIDC Prompt Create 1.0)", () => {
	it("is advertised in discovery with the other prompt values", async () => {
		const discovery: unknown = await (
			await fetch(`${idp.issuer}/.well-known/openid-configuration`)
		).json();
		expect(discovery).toMatchObject({
			prompt_values_supported: ["none", "create", "login", "consent"],
		});
	});

	it("opens sign-up and returns a valid code once the account exists", async () => {
		const config = await localmanWeb(idp);
		const browser = new TestBrowser();
		const start = await authorize(browser, config, LOCALMAN_CALLBACK, {
			scope: "openid profile",
			prompt: "create",
		});
		const page = await start.response.text();
		expect(page).toContain(SIGNUP_TITLE);
		expect(page).toContain(`/interaction/${start.uid}/login`);

		const { name, location } = await signUp(browser, start.uid, page);
		if (!location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(
			config,
			location,
			start.checks,
		);
		const created = await repositoryOf(idp).findByIdentifier(name);
		const sub = tokens.claims()?.sub ?? "";
		expect(sub).toBe(created?._id);
		const userinfo = await client.fetchUserInfo(
			config,
			tokens.access_token,
			sub,
		);
		expect(userinfo.preferred_username).toBe(name);
	});

	it("still shows sign-up with a live session; the login link keeps the interaction", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const config = await localmanWeb(idp);
		const start = await authorize(browser, config, LOCALMAN_CALLBACK, {
			scope: "openid",
			prompt: "create",
		});
		expect(start.location).toBeUndefined();
		expect(await start.response.text()).toContain(SIGNUP_TITLE);

		const login = await (
			await browser.request(`${idp.issuer}/interaction/${start.uid}/login`)
		).text();
		expect(login).toContain(`action="/interaction/${start.uid}/login"`);
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${start.uid}/login`,
			{
				csrf: formField(login, "csrf"),
				identifier: account.username,
				password: TEST_PASSWORD,
			},
			LOCALMAN_CALLBACK,
		);
		if (!back.location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(
			config,
			back.location,
			start.checks,
		);
		expect(tokens.claims()?.sub).toBe(account._id);
	});

	it("rejects prompt=create together with none", async () => {
		const start = await authorize(
			new TestBrowser(),
			await localmanWeb(idp),
			LOCALMAN_CALLBACK,
			{ scope: "openid", prompt: "create none" },
		);
		expect(start.location?.searchParams.get("error")).toBe("invalid_request");
	});

	it("works for a dynamically registered (MCP) client too", async () => {
		const registered = await client.dynamicClientRegistration(
			new URL(idp.issuer),
			{ redirect_uris: [MCP_REDIRECT], token_endpoint_auth_method: "none" },
			client.None(),
			{ execute: [client.allowInsecureRequests] },
		);
		const config = await discoverClient(
			idp,
			registered.clientMetadata().client_id,
			client.None(),
		);
		const start = await authorize(new TestBrowser(), config, MCP_REDIRECT, {
			scope: "mock:read",
			resource: RESOURCES.localmanMcp,
			prompt: "create",
		});
		expect(await start.response.text()).toContain(SIGNUP_TITLE);
	});

	it("leaves the ordinary flow on the login page", async () => {
		const start = await authorize(
			new TestBrowser(),
			await localmanWeb(idp),
			LOCALMAN_CALLBACK,
			{ scope: "openid" },
		);
		const page = await start.response.text();
		expect(page).toContain(`action="/interaction/${start.uid}/login"`);
		expect(page).not.toContain(SIGNUP_TITLE);
	});
});
