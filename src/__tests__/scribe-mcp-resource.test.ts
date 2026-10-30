import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listedApps } from "../app-directory/apps-catalog.js";
import { SCRIBE_MCP_SCOPES } from "../oidc/resources.js";
import {
	accessTokenScopes,
	consentAndRedeem,
	registerMcpClient,
} from "./helpers/mcp-consent-flows.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import type { TestBrowser } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown, testPage } from "./helpers/test-page.js";
import { PRIMARY_TEST_TENANT, RESOURCES } from "./helpers/test-tenant.js";

let idp: TestIdp;
let browser: TestBrowser;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
	browser = await signedInBrowser(
		idp,
		await createTestAccount(repositoryOf(idp)),
	);
});

afterAll(async () => {
	await idp?.close();
});

describe("Scribe MCP resource for DCR clients", () => {
	it("is https://scribe.<domain>/mcp", () => {
		expect(RESOURCES.scribeMcp).toBe("https://scribe.hoandat.com/mcp");
		expect([...SCRIBE_MCP_SCOPES]).toEqual(["scribe:read"]);
	});

	it("advertises scribe:read in discovery", async () => {
		const response = await fetch(
			`${idp.issuer}/.well-known/openid-configuration`,
		);
		const metadata = (await response.json()) as { scopes_supported: unknown };
		expect(metadata.scopes_supported).toEqual(
			expect.arrayContaining([...SCRIBE_MCP_SCOPES]),
		);
	});

	it("issues a token for the Scribe /mcp audience after consent that says it reads transcripts", async () => {
		const config = await registerMcpClient(idp);
		expect(String(config.clientMetadata().scope).split(" ")).toContain(
			"scribe:read",
		);
		const result = await consentAndRedeem(
			idp,
			browser,
			config,
			"scribe:read",
			RESOURCES.scribeMcp,
		);
		expect(result.page).toContain(shown("scope.scribeRead"));
		expect(await accessTokenScopes(idp, RESOURCES.scribeMcp, result)).toEqual([
			"scribe:read",
		]);
	});

	it("binds a request without resource but with only scribe:read to Scribe /mcp", async () => {
		const config = await registerMcpClient(idp);
		const result = await consentAndRedeem(idp, browser, config, "scribe:read");
		expect(await accessTokenScopes(idp, RESOURCES.scribeMcp, result)).toEqual([
			"scribe:read",
		]);
	});

	it("rejects a client that registers a Scribe write scope", async () => {
		await expect(
			registerMcpClient(idp, { scope: "scribe:read scribe:write" }),
		).rejects.toMatchObject({ error: "invalid_client_metadata" });
	});
});

describe("Scribe MCP in the app catalog", () => {
	const page = testPage("en", "/apps");

	it("is listed with its /mcp address once Scribe is configured", () => {
		const tenant = {
			...PRIMARY_TEST_TENANT,
			webApps: {
				...PRIMARY_TEST_TENANT.webApps,
				scribe: "https://scribe.hoandat.com",
			},
		};
		const entry = listedApps(tenant, page.i18n).find(
			(app) => app.id === "scribe-mcp",
		);
		expect(entry?.kind).toBe("apps.kind.mcp");
		expect(String(entry?.signIn)).toContain(RESOURCES.scribeMcp);
	});

	it("is not listed while Scribe is not configured", () => {
		const ids = listedApps(PRIMARY_TEST_TENANT, page.i18n).map((app) => app.id);
		expect(ids).not.toContain("scribe-mcp");
	});
});
