import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CREDENTIALS_SCOPE } from "../oidc/resources.js";
import { authorizationRedirect } from "./helpers/flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { createAccessTokenVerifier } from "./helpers/verify-access-token.js";

const MCP_REDIRECT = "http://127.0.0.1:33420/callback";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function registerMcpClient(scope?: string): Promise<client.Configuration> {
	return client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: [MCP_REDIRECT],
			token_endpoint_auth_method: "none",
			client_name: "Agent",
			...(scope ? { scope } : {}),
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
}

describe("credentials:write scope for MCP clients", () => {
	it("is advertised in discovery", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		const metadata = (await response.json()) as { scopes_supported: unknown };
		expect(metadata.scopes_supported).toContain(CREDENTIALS_SCOPE);
	});

	it("is never part of the default DCR scope", async () => {
		const config = await registerMcpClient();
		const scopes = String(config.clientMetadata().scope).split(" ");
		expect(scopes).not.toContain(CREDENTIALS_SCOPE);
		const location = await authorizationRedirect(config, MCP_REDIRECT, {
			scope: `mock:read ${CREDENTIALS_SCOPE}`,
			resource: RESOURCES.localmanMcp,
		});
		expect(location.searchParams.get("error")).toBe("invalid_scope");
	});

	it("shows a red warning on consent, then issues the scope for /mcp", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const config = await registerMcpClient(`mock:read ${CREDENTIALS_SCOPE}`);
		const verifier = client.randomPKCECodeVerifier();
		const state = client.randomState();
		const url = client.buildAuthorizationUrl(config, {
			redirect_uri: MCP_REDIRECT,
			scope: `mock:read ${CREDENTIALS_SCOPE}`,
			resource: RESOURCES.localmanMcp,
			code_challenge: await client.calculatePKCECodeChallenge(verifier),
			code_challenge_method: "S256",
			state,
		});
		const { response } = await browser.navigate(url, {}, MCP_REDIRECT);
		const page = await response.text();
		expect(page).toMatch(
			/<div class="alert alert-error"[^>]*><span data-id="consent-credentials-warning">/,
		);
		expect(page).toContain(shown("consent.credentialsWarning"));
		expect(page).toContain("service account secrets and access keys");

		const uid = /\/interaction\/([\w-]+)/.exec(response.url)?.[1] ?? "";
		const back = await submitForm(
			browser,
			`${idp.issuer}/interaction/${uid}/consent`,
			{ csrf: formField(page, "csrf") },
			MCP_REDIRECT,
		);
		if (!back.location) throw new Error("did not return to the client");
		const tokens = await client.authorizationCodeGrant(config, back.location, {
			pkceCodeVerifier: verifier,
			expectedState: state,
		});
		const payload = await createAccessTokenVerifier({
			issuer: idp.issuer,
			audience: RESOURCES.localmanMcp,
			jwksUri: `${idp.issuer}/jwks`,
		})(tokens.access_token);
		expect(String(payload.scope).split(" ").sort()).toEqual([
			CREDENTIALS_SCOPE,
			"mock:read",
		]);
	});
});
