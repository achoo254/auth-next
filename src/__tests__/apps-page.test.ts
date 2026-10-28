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
		// MCP and CLI entries are not listed, so no device-code address shows.
		expect(html).not.toContain("https://auth.staging.example/device");
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
					tieude: "https://tieude.staging.example",
				},
			},
			testPage("en", "/apps"),
		);
		const marks = [
			...html.matchAll(
				/(?:src|href)="\/assets\/img\/(apps\/[a-z0-9-]+\.webp)"/g,
			),
		].map((match) => match[1]);
		// Localman, Tunelo, Chat, Scribe, Miu World, Tiểu Đệ: web apps only.
		expect(new Set(marks).size).toBe(6);
		for (const mark of marks) {
			expect(existsSync(`${STATIC_DIR}/img/${mark}`), mark).toBe(true);
		}
	});

	it("puts the hoandat mark, a file in static/img, before the wordmark", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain(
			`<a href="/apps" class="shell-brand" data-id="public-home"><img class="shell-brand-mark" src="${BRAND_MARK_PATH}" width="24" height="24" alt="" aria-hidden="true"/><b class="shell-brand-name">hoandat.com</b></a>`,
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
		// Apps for fun are listed in their own group, not drawn in the work diagram.
		expect(html).not.toContain(">Miu World</text>");
		expect(html).toContain("signs you in to Localman, Tunelo, and Chat.");
		const fun = html.slice(html.indexOf('data-id="apps-group-fun"'));
		expect(fun).toContain('data-id="app-miu-web"');
		expect(html.indexOf('data-id="apps-group-work"')).toBeLessThan(
			html.indexOf('data-id="apps-group-fun"'),
		);
		const vi = renderAppsPage(withMiu, testPage("vi", "/apps"));
		expect(vi).toContain("vừa chơi vừa học Toán và Tiếng Việt");

		const unconfigured = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(unconfigured).not.toContain('data-id="app-miu-web"');
		expect(unconfigured).not.toContain(miu);
	});

	it("lists Tiểu Đệ with its mark once its client is configured", () => {
		const tieude = "https://tieude.staging.example";
		const withTieude = { ...STAGING, webApps: { ...STAGING.webApps, tieude } };
		const html = renderAppsPage(withTieude, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-tieude-web"');
		expect(html).toContain(`href="${tieude}"`);
		expect(html).toContain("/assets/img/apps/tieude-mark-128.webp");
		expect(html).toContain("small writing jobs for free");
		expect(renderAppsPage(withTieude, testPage("vi", "/apps"))).toContain(
			"Bot AI làm giúp miễn phí",
		);
		expect(renderAppsPage(withTieude, testPage("zh-CN", "/apps"))).toContain(
			"AI 机器人",
		);
		expect(renderAppsPage(STAGING, testPage("en", "/apps"))).not.toContain(
			'data-id="app-tieude-web"',
		);
	});

	it("lists Web Nhanh as a work app with its mark once its client is configured", () => {
		const webnhanh = "https://webnhanh.staging.example";
		const withWebnhanh = {
			...STAGING,
			webApps: { ...STAGING.webApps, webnhanh },
		};
		const html = renderAppsPage(withWebnhanh, testPage("en", "/apps"));
		expect(html).toContain('data-id="app-open-webnhanh-web"');
		expect(html).toContain(`href="${webnhanh}"`);
		expect(html).toContain("/assets/img/apps/webnhanh-mark-128.webp");
		expect(html).toContain("publish it at its own address");
		// A work app: drawn in the diagram and listed before the fun group.
		expect(html).toContain(">Web Nhanh</text>");
		expect(html).toContain(
			"signs you in to Localman, Tunelo, Chat, and Web Nhanh.",
		);
		expect(html).not.toContain('data-id="apps-group-fun"');
		const work = html.slice(html.indexOf('data-id="apps-group-work"'));
		expect(work).toContain('data-id="app-webnhanh-web"');
		expect(renderAppsPage(withWebnhanh, testPage("vi", "/apps"))).toContain(
			"Làm website từ mẫu có sẵn",
		);
		expect(renderAppsPage(withWebnhanh, testPage("zh-CN", "/apps"))).toContain(
			"用现成模板制作网站",
		);
		expect(renderAppsPage(STAGING, testPage("en", "/apps"))).not.toContain(
			'data-id="app-webnhanh-web"',
		);
	});

	it("ends every page with the brand's home link and the privacy policy", () => {
		const html = renderAppsPage(STAGING, testPage("vi", "/apps"));
		expect(html).toContain(
			'<a class="shell-foot-link" href="https://hoandat.com" data-id="foot-home">Một app của hoandat.com</a>',
		);
		expect(html).toContain('data-id="foot-privacy"');
		expect(html).toContain(
			'<meta property="og:image" content="https://auth.hoandat.com/assets/img/og-image.jpg">',
		);
		expect(existsSync(`${STATIC_DIR}/img/og-image.jpg`)).toBe(true);
	});

	it("links the sign-in steps from the hero", () => {
		const html = renderAppsPage(STAGING, testPage("en", "/apps"));
		expect(html).toContain('href="#how-sign-in-works"');
		expect(html).toContain('id="how-sign-in-works"');
	});
});
