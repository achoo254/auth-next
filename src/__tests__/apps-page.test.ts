import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderAppsPage } from "../app-directory/apps-page.js";
import { STATIC_DIR } from "../assets.js";
import { BRAND_MARK_PATH } from "../ui/layout.js";
import { testPage } from "./helpers/test-page.js";

const STAGING = {
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

	it("shows each app's mark from a file in static/img", () => {
		const html = renderAppsPage(
			{
				...STAGING,
				webApps: {
					...STAGING.webApps,
					scribe: "https://scribe.staging.example",
					miu: "https://miu.staging.example",
				},
			},
			testPage("en", "/apps"),
		);
		const marks = [
			...html.matchAll(
				/(?:src|href)="\/assets\/img\/(apps\/[a-z0-9-]+\.webp)"/g,
			),
		].map((match) => match[1]);
		expect(new Set(marks).size).toBe(7);
		for (const mark of marks) {
			expect(existsSync(`${STATIC_DIR}/img/${mark}`), mark).toBe(true);
		}
	});

	it("puts the hoandat mark, a file in static/img, before the wordmark", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain(
			`<a class="idp-brand" href="/apps" data-id="idp-brand"><img class="idp-brand-mark" src="${BRAND_MARK_PATH}" width="24" height="24" alt="" aria-hidden="true">`,
		);
		expect(
			existsSync(
				`${STATIC_DIR}/img/${BRAND_MARK_PATH.replace("/assets/img/", "")}`,
			),
		).toBe(true);
	});

	it("lists chat at the configured chat host", () => {
		const html = renderAppsPage(
			{
				...STAGING,
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

	it("lists Scribe once its client is configured", () => {
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
	});

	it("lists Miu World once its client is configured", () => {
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

		const unconfigured = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(unconfigured).not.toContain('data-id="app-miu-web"');
		expect(unconfigured).not.toContain(miu);
	});

	it("links the sign-in steps from the hero", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="#how-sign-in-works"');
		expect(html).toContain('id="how-sign-in-works"');
	});
});
