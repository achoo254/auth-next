import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { discoverClient } from "./helpers/flows.js";
import { getWithHost } from "./helpers/request-with-host.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	LOCALMAN_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	// Production wiring: the real interaction pages, no automatic sign-in.
	idp = await startTestIdp({ interactions: "real" });
});

afterAll(async () => {
	await idp?.close();
});

describe("HTTP shell", () => {
	it("answers /healthz with 200 and security headers", async () => {
		const response = await fetch(`${idp.issuer}/healthz`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "ok" });
		expect(response.headers.get("x-powered-by")).toBeNull();
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain("script-src 'self'");
	});
});

describe("Privacy policy", () => {
	it("serves a public privacy page without a session", async () => {
		const response = await fetch(`${idp.issuer}/privacy`);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain("Privacy policy");
		expect(body).toContain("argon2id");
	});
});

describe("App list", () => {
	it("serves the public app list without a session", async () => {
		const response = await fetch(`${idp.issuer}/apps`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-cache");
		const body = await response.text();
		expect(body).toContain("One account for every hoandat app");
		expect(body).toContain('href="/assets/css/apps.css"');
		for (const name of ["Localman", "Localman MCP", "Tunelo CLI", "Tunelo"]) {
			expect(body).toContain(`class="app-card-name">${name}</h3>`);
		}
		// Addresses come from the environment (the defaults here).
		expect(body).toContain('href="https://localman.hoandat.com"');
		expect(body).toContain('href="https://tunnel.hoandat.com"');
		expect(body).toContain(`${idp.issuer}/device`);
		expect(body).toContain("https://localman.hoandat.com/mcp");
	});

	it("sends the bare domain to the app list", async () => {
		const response = await fetch(`${idp.issuer}/`, { redirect: "manual" });
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/apps");
	});
});

describe("Host check", () => {
	it("answers 421 for a Host that is not the issuer's, except /healthz", async () => {
		const discovery = `${idp.issuer}/.well-known/openid-configuration`;
		expect((await getWithHost(discovery, "evil.example")).status).toBe(421);
		expect(
			(await getWithHost(discovery, new URL(idp.issuer).host)).status,
		).toBe(200);
		// Container healthchecks call 127.0.0.1 whatever the public host is.
		expect(
			(await getWithHost(`${idp.issuer}/healthz`, "evil.example")).status,
		).toBe(200);
	});

	it("normalises forwarded headers before interaction handlers run", async () => {
		const echo = await startTestIdp({
			interactions: (req, res) => {
				res.json({
					forwardedHost: req.headers["x-forwarded-host"] ?? null,
					forwardedProto: req.headers["x-forwarded-proto"],
				});
			},
		});
		try {
			const response = await fetch(`${echo.issuer}/interaction/x`, {
				headers: { "x-forwarded-host": "evil.example" },
			});
			expect(await response.json()).toEqual({
				forwardedHost: null,
				forwardedProto: "http",
			});
		} finally {
			await echo.close();
		}
	});
});

describe("discovery", () => {
	it("advertises every enabled endpoint and feature", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		const metadata = (await response.json()) as Record<string, unknown>;
		expect(metadata.issuer).toBe(idp.issuer);
		for (const endpoint of [
			"authorization_endpoint",
			"token_endpoint",
			"userinfo_endpoint",
			"jwks_uri",
			"device_authorization_endpoint",
			"revocation_endpoint",
			"introspection_endpoint",
			"end_session_endpoint",
			"registration_endpoint",
		]) {
			expect(metadata[endpoint], endpoint).toEqual(expect.any(String));
		}
		expect(metadata.backchannel_logout_supported).toBe(true);
		expect(metadata.id_token_signing_alg_values_supported).toEqual(["ES256"]);
		expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
		expect(metadata.response_types_supported).toEqual(["code"]);
		expect(metadata.scopes_supported).toEqual(
			expect.arrayContaining(["openid", "tunnels:open", "mock:read"]),
		);
	});

	it("publishes every signing key without private material", async () => {
		const response = await fetch(`${idp.issuer}/jwks`);
		const { keys } = (await response.json()) as {
			keys: Record<string, unknown>[];
		};
		expect(keys.map((key) => key.kid)).toEqual(
			idp.jwks.keys.map((key) => key.kid),
		);
		for (const key of keys) {
			expect(key).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
			expect(key).not.toHaveProperty("d");
		}
	});
});

describe("interaction pages without a session", () => {
	it("stops a real authorization request at the login page", async () => {
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.localmanWeb,
			client.ClientSecretBasic(LOCALMAN_WEB_SECRET),
		);
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: LOCALMAN_CALLBACK,
			scope: "openid",
			code_challenge: await client.calculatePKCECodeChallenge(
				client.randomPKCECodeVerifier(),
			),
			code_challenge_method: "S256",
		});
		const { response, location } = await new TestBrowser().navigate(
			url,
			{},
			LOCALMAN_CALLBACK,
		);
		expect(location).toBeUndefined();
		expect(response.status).toBe(200);
		expect(new URL(response.url).pathname).toMatch(/^\/interaction\//);
		const page = await response.text();
		expect(page).toContain("Sign in to continue to Localman");
		expect(page).toContain('name="csrf"');
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("never completes a device approval without signing in", async () => {
		const config = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tuneloCli,
			client.None(),
		);
		const authorization = await client.initiateDeviceAuthorization(config, {
			scope: "openid tunnels:read",
		});
		const browser = new TestBrowser();
		const page = await browser.request(authorization.verification_uri);
		const xsrf = formField(await page.text(), "xsrf");
		const { response } = await browser.navigate(
			authorization.verification_uri,
			{
				form: { xsrf, user_code: authorization.user_code, confirm: "yes" },
			},
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("Sign in to approve a device.");
		await expect(
			client.genericGrantRequest(
				config,
				"urn:ietf:params:oauth:grant-type:device_code",
				{ device_code: authorization.device_code },
			),
		).rejects.toMatchObject({ error: "authorization_pending" });
	});
});
