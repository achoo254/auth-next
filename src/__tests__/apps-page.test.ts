import { describe, expect, it } from "vitest";
import { renderAppsPage } from "../app-directory/apps-page.js";
import { testPage } from "./helpers/test-page.js";

const STAGING = {
	ISSUER: "https://auth.staging.example",
	LOCALMAN_WEB_URL: "https://localman.staging.example",
	TUNELO_WEB_URL: "https://tunnel.staging.example",
};

describe("app list page", () => {
	it("links each web app to the address of this environment", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="https://localman.staging.example"');
		expect(html).toContain('href="https://tunnel.staging.example"');
		expect(html).toContain("https://auth.staging.example/device");
		expect(html).not.toContain('https://localman.hoandat.com"');
	});

	it("gives only the web apps an Open button", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-localman-web"');
		expect(html).toContain('data-id="app-open-tunelo-web"');
		expect(html).not.toContain('data-id="app-open-tunelo-cli"');
		expect(html).not.toContain('data-id="app-open-localman-mcp"');
	});
});
