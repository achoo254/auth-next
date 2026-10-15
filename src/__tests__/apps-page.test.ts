import { describe, expect, it } from "vitest";
import { renderAppsPage } from "../app-directory/apps-page.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import { testPage } from "./helpers/test-page.js";

const STAGING = {
	id: PRIMARY_TENANT_ID,
	issuer: "https://auth.staging.example",
	domain: "hoandat.com",
	webApps: {
		localman: "https://localman.staging.example",
		tunelo: "https://tunnel.staging.example",
		chat: "https://chat.staging.example",
	},
};

describe("app list page", () => {
	it("links each web app to the address of this environment", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="https://localman.staging.example"');
		expect(html).toContain('href="https://tunnel.staging.example"');
		expect(html).toContain('href="https://chat.staging.example"');
		expect(html).toContain("https://auth.staging.example/device");
		expect(html).not.toContain('https://localman.hoandat.com"');
	});

	it("gives only the web apps an Open button", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-localman-web"');
		expect(html).toContain('data-id="app-open-tunelo-web"');
		expect(html).toContain('data-id="app-open-chat-web"');
		expect(html).not.toContain('data-id="app-open-tunelo-cli"');
		expect(html).not.toContain('data-id="app-open-localman-mcp"');
	});

	it("draws the hub with the issuer's host and every listed app", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		const hub = html.slice(html.indexOf('data-id="apps-hub"'));
		expect(hub).toContain(">auth.staging.example</text>");
		for (const name of [
			"Google",
			"GitHub",
			"Localman",
			"Localman MCP",
			"Tunelo CLI",
			"Tunelo",
			"Chat",
		]) {
			expect(hub).toContain(`>${name}</text>`);
		}
		expect(html).toContain('role="img"');
		expect(html).toContain(
			"signs you in to Localman, Localman MCP, Tunelo CLI, Tunelo, and Chat.",
		);
	});

	it("lists chat only for the primary tenant, the one with a chat host", () => {
		const html = renderAppsPage(
			{ ...STAGING, id: "tenant-inetdev" },
			testPage("en", "/apps"),
		);
		expect(html).not.toContain('data-id="app-chat-web"');
		expect(html).not.toContain("https://chat.staging.example");
		expect(html).not.toContain(">Chat</text>");
		expect(html).toContain(
			"signs you in to Localman, Localman MCP, Tunelo CLI, and Tunelo.",
		);
	});

	it("links the sign-in steps from the hero", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="#how-sign-in-works"');
		expect(html).toContain('id="how-sign-in-works"');
	});
});
