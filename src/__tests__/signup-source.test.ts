import { randomUUID } from "node:crypto";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	sanitizeSourceTag,
	signupSourceOf,
} from "../accounts/signup-source.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { localmanWeb } from "./helpers/exchange-flows.js";
import { repositoryOf, submitForm } from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { continuePastWelcome } from "./helpers/upstream-sign-in.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("signup source tags", () => {
	it("keeps lowercase [a-z0-9_-], at most 64 characters", () => {
		expect(sanitizeSourceTag("FB_Ads")).toBe("fb_ads");
		expect(sanitizeSourceTag("  Tết 2027 / Short ")).toBe("t_t_2027_short");
		expect(sanitizeSourceTag("facebook.com")).toBe("facebook_com");
		expect(sanitizeSourceTag("spring-sale")).toBe("spring-sale");
		expect(sanitizeSourceTag("a".repeat(80))).toBe("a".repeat(64));
		expect(sanitizeSourceTag(`${"b".repeat(63)} x`)).toBe("b".repeat(63));
	});

	it("records nothing for a missing, empty, repeated or unusable tag", () => {
		expect(sanitizeSourceTag(undefined)).toBeNull();
		expect(sanitizeSourceTag("")).toBeNull();
		expect(sanitizeSourceTag("   ")).toBeNull();
		expect(sanitizeSourceTag("🙂🙂")).toBeNull();
		expect(sanitizeSourceTag(["fb", "ig"])).toBeNull();
	});

	it("reads the client and the valid tags of an interaction", () => {
		expect(
			signupSourceOf({
				client_id: "tuvi-web",
				utm_source: "FB",
				utm_medium: "!!!",
				utm_campaign: "short",
			}),
		).toEqual({ client: "tuvi-web", utmSource: "fb", utmCampaign: "short" });
		expect(signupSourceOf({ client_id: "tuvi-web" })).toEqual({
			client: "tuvi-web",
		});
		expect(signupSourceOf({})).toBeUndefined();
	});
});

/** prompt=create on localman-web with `extra` parameters, signed up with a new Google account. */
async function signUpThrough(extra: Record<string, string>) {
	const config = await localmanWeb(idp);
	const browser = new TestBrowser();
	const url = client.buildAuthorizationUrl(config, {
		redirect_uri: LOCALMAN_CALLBACK,
		code_challenge: await client.calculatePKCECodeChallenge(
			client.randomPKCECodeVerifier(),
		),
		code_challenge_method: "S256",
		state: client.randomState(),
		scope: "openid",
		prompt: "create",
		...extra,
	});
	const landed = await browser.navigate(url, {}, LOCALMAN_CALLBACK);
	const uid = /\/interaction\/([\w-]+)/.exec(landed.response.url)?.[1] ?? "";
	expect(uid).not.toBe("");
	const name = `src_${randomUUID().slice(0, 8)}`;
	idp.fake.nextLogins.push({
		id: `g-${name}`,
		email: `${name}@example.com`,
		emailVerified: true,
	});
	const chosen = await browser.navigate(
		`${idp.issuer}/interaction/${uid}/upstream/google`,
	);
	const signup = await submitForm(
		browser,
		`${idp.issuer}/interaction/${uid}/upstream/signup`,
		{ csrf: formField(await chosen.response.text(), "csrf"), username: name },
		LOCALMAN_CALLBACK,
	);
	const done = await continuePastWelcome(browser, signup, LOCALMAN_CALLBACK);
	expect(done.location?.searchParams.get("code")).toBeTruthy();
	return repositoryOf(idp).findByProvider("google", `g-${name}`);
}

describe("signup source on a new account", () => {
	it("records the client and the app's UTM tags", async () => {
		const account = await signUpThrough({
			utm_source: "FB_Ads",
			utm_medium: "paid",
			utm_campaign: "Short 11",
		});
		expect(account?.signupSource).toEqual({
			client: STATIC_CLIENT_IDS.localmanWeb,
			utmSource: "fb_ads",
			utmMedium: "paid",
			utmCampaign: "short_11",
		});
	});

	it("records the client alone without tags, and never refuses a bad tag", async () => {
		expect((await signUpThrough({}))?.signupSource).toEqual({
			client: STATIC_CLIENT_IDS.localmanWeb,
		});
		expect((await signUpThrough({ utm_source: "%%%" }))?.signupSource).toEqual({
			client: STATIC_CLIENT_IDS.localmanWeb,
		});
	});

	it("refuses a tag repeated on the authorization request, like any parameter", async () => {
		const config = await localmanWeb(idp);
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: LOCALMAN_CALLBACK,
			code_challenge: await client.calculatePKCECodeChallenge(
				client.randomPKCECodeVerifier(),
			),
			code_challenge_method: "S256",
			state: client.randomState(),
			scope: "openid",
			prompt: "create",
			utm_source: "fb",
		});
		url.searchParams.append("utm_source", "ig");
		const landed = await new TestBrowser().navigate(url, {}, LOCALMAN_CALLBACK);
		expect(landed.location?.searchParams.get("error")).toBe("invalid_request");
	});

	it("passes the sign-up link's tags on from /account?signup=1", async () => {
		const response = await fetch(
			`${idp.issuer}/account?signup=1&utm_source=Zalo&utm_campaign=tet&other=x`,
			{ redirect: "manual" },
		);
		const to = new URL(response.headers.get("location") ?? "", idp.issuer);
		expect(to.searchParams.get("prompt")).toBe("create");
		expect(to.searchParams.get("utm_source")).toBe("zalo");
		expect(to.searchParams.get("utm_campaign")).toBe("tet");
		expect(to.searchParams.has("utm_medium")).toBe(false);
		expect(to.searchParams.has("other")).toBe(false);
	});

	it("passes on only the first value of a tag the link repeats", async () => {
		const response = await fetch(
			`${idp.issuer}/account?signup=1&utm_source=FB&utm_source=ig`,
			{ redirect: "manual" },
		);
		const to = new URL(response.headers.get("location") ?? "", idp.issuer);
		expect(to.searchParams.getAll("utm_source")).toEqual(["fb"]);
	});
});
