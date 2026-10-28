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
		expect(csp).toContain(
			"script-src 'self' https://static.cloudflareinsights.com;",
		);
		expect(csp).toContain("connect-src 'self' https://cloudflareinsights.com;");
	});

	it("lets the shell's theme script run from this origin, and no inline script", async () => {
		const response = await fetch(`${idp.issuer}/apps`);
		const csp = response.headers.get("content-security-policy") ?? "";
		const scriptSrc = /(?:^|;)script-src ([^;]*)/.exec(csp)?.[1] ?? "";
		expect(scriptSrc.split(" ")).toContain("'self'");
		expect(scriptSrc).not.toMatch(/unsafe-inline|unsafe-eval|nonce-|sha256-/);
		expect(csp).toContain("script-src-attr 'none'");
		expect(csp).toContain("style-src 'self';");
		const page = await response.text();
		const src =
			/<script src="(\/assets\/app-shell\/app-shell-enhance\.js\?v=[0-9a-f]{12})"><\/script>/.exec(
				page,
			)?.[1];
		expect(src).toBeDefined();
		const script = await fetch(`${idp.issuer}${src}`);
		expect(script.status).toBe(200);
		expect(script.headers.get("content-type")).toMatch(/javascript/);
		expect(script.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		// Only the shell's three files are served from the package.
		for (const other of [
			"/assets/app-shell/index.js",
			"/assets/app-shell/package.json",
			"/assets/app-shell/../package.json",
		]) {
			expect((await fetch(`${idp.issuer}${other}`)).status, other).toBe(404);
		}
	});
});

describe("Privacy policy", () => {
	it("serves a public privacy page without a session", async () => {
		const response = await fetch(`${idp.issuer}/privacy`);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body).toContain("Privacy policy");
		expect(body).toContain("argon2id");
		expect(body).toContain('data-id="privacy-youtube"');
		expect(body).toContain('href="https://www.youtube.com/t/terms"');
		expect(body).toContain('href="https://policies.google.com/privacy"');
	});
});

describe("Stylesheets", () => {
	it("links each stylesheet by its content hash and caches only that URL for long", async () => {
		const page = await (await fetch(`${idp.issuer}/apps`)).text();
		const href = page.match(
			/href="(\/assets\/css\/app\.css\?v=[0-9a-f]{12})"/,
		)?.[1];
		expect(href).toBeDefined();
		const current = await fetch(`${idp.issuer}${href}`);
		expect(current.status).toBe(200);
		expect(current.headers.get("cache-control")).toBe(
			"public, max-age=31536000, immutable",
		);
		for (const other of ["/assets/css/app.css", "/assets/css/app.css?v=old"]) {
			const response = await fetch(`${idp.issuer}${other}`);
			expect(response.status, other).toBe(200);
			expect(response.headers.get("cache-control"), other).toBe(
				"public, max-age=3600",
			);
		}
	});
});

describe("App list", () => {
	it("serves the public app list without a session", async () => {
		const response = await fetch(`${idp.issuer}/apps`);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-cache");
		const body = await response.text();
		expect(body).toContain("One account for every hoandat.com app");
		expect(body).toMatch(/href="\/assets\/css\/apps\.css\?v=[0-9a-f]{12}"/);
		// Only apps with a web page of their own are showcased.
		for (const name of ["Localman", "Tunelo"]) {
			expect(body).toContain(`class="app-card-name">${name}</h3>`);
		}
		// Addresses come from the environment (the defaults here).
		expect(body).toContain('href="https://localman.hoandat.com"');
		expect(body).toContain('href="https://tunnel.hoandat.com"');
		expect(body).not.toContain('class="app-card-name">Localman MCP</h3>');
		expect(body).not.toContain('class="app-card-name">Tunelo CLI</h3>');
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
		expect(metadata.id_token_signing_alg_values_supported).toEqual([
			"ES256",
			"RS256",
		]);
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
			if (key.kty === "RSA") {
				expect(key).toMatchObject({ alg: "RS256", use: "sig" });
			} else {
				expect(key).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
			}
			for (const secret of ["d", "p", "q", "dp", "dq", "qi"]) {
				expect(key).not.toHaveProperty(secret);
			}
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
