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

	it("draws the hub with the issuer's host and the main apps only", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		const hub = html.slice(html.indexOf('data-id="apps-hub"'));
		expect(hub).toContain(">auth.staging.example</text>");
		for (const name of ["Google", "GitHub", "Localman", "Tunelo", "Chat"]) {
			expect(hub).toContain(`>${name}</text>`);
		}
		expect(hub).not.toContain(">Localman MCP</text>");
		expect(hub).not.toContain(">Tunelo CLI</text>");
		expect(html).toContain('role="img"');
		expect(html).toContain("signs you in to Localman, Tunelo, and Chat.");
	});

	it("lists chat for every tenant, at the tenant's own chat host", () => {
		const html = renderAppsPage(
			{
				...STAGING,
				id: "tenant-inetdev",
				webApps: { ...STAGING.webApps, chat: "https://chat.inetdev.example" },
			},
			testPage("en", "/apps"),
		);
		expect(html).toContain('data-id="app-open-chat-web"');
		expect(html).toContain('href="https://chat.inetdev.example"');
		expect(html).not.toContain("https://chat.staging.example");
		expect(html).toContain(">Chat</text>");
		expect(html).toContain("signs you in to Localman, Tunelo, and Chat.");
	});

	it("lists Scribe for a tenant once it has Scribe", () => {
		const scribe = "https://scribe.staging.example";
		const withScribe = { ...STAGING, webApps: { ...STAGING.webApps, scribe } };
		const html = renderAppsPage(withScribe, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-scribe-web"');
		expect(html).toContain(`href="${scribe}"`);
		expect(html).toContain(">Scribe</text>");
		expect(html).toContain(
			"signs you in to Localman, Tunelo, Chat, and Scribe.",
		);
		const vi = renderAppsPage(withScribe, testPage("vi", "/apps"));
		expect(vi).toContain("Ghi âm và chuyển thành bản chép lời");

		const unconfigured = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(unconfigured).not.toContain('data-id="app-scribe-web"');
		// A registry tenant has webApps.scribe only once it turned Scribe on.
		const other = renderAppsPage(
			{ ...STAGING, id: "tenant-inetdev" },
			testPage("en", "/apps"),
		);
		expect(other).not.toContain('data-id="app-scribe-web"');
		const otherOn = renderAppsPage(
			{ ...withScribe, id: "tenant-inetdev" },
			testPage("en", "/apps"),
		);
		expect(otherOn).toContain('data-id="app-open-scribe-web"');
		expect(otherOn).toContain(`href="${scribe}"`);
	});

	it("lists Miu World for the primary tenant once its client is configured", () => {
		const miu = "https://miu.staging.example";
		const withMiu = { ...STAGING, webApps: { ...STAGING.webApps, miu } };
		const html = renderAppsPage(withMiu, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-miu-web"');
		expect(html).toContain(`href="${miu}"`);
		expect(html).toContain(">Miu World</text>");
		expect(html).toContain(
			"signs you in to Localman, Tunelo, Chat, and Miu World.",
		);
		const vi = renderAppsPage(withMiu, testPage("vi", "/apps"));
		expect(vi).toContain("vừa chơi vừa học Toán và Tiếng Việt");

		const other = renderAppsPage(
			{ ...withMiu, id: "tenant-inetdev" },
			testPage("en", "/apps"),
		);
		expect(other).not.toContain('data-id="app-miu-web"');
		expect(other).not.toContain(miu);
	});

	it("links the sign-in steps from the hero", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="#how-sign-in-works"');
		expect(html).toContain('id="how-sign-in-works"');
	});
});
