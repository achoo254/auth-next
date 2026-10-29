import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { shown, testPage } from "../__tests__/helpers/test-page.js";
import { brand } from "../brand.js";
import { LOCALES } from "../i18n/locales.js";
import { html } from "./html.js";
import { type PageOptions, renderPage } from "./layout.js";

function page(options: Partial<PageOptions> = {}): string {
	return renderPage({
		title: "Title",
		body: html`<p data-id="the-body">Body &amp; text</p>`,
		page: testPage("en", "/apps"),
		...options,
	});
}

/** `<main …>…</main>` of a page. */
function mainOf(markup: string): string {
	return /<main[^>]*>[\s\S]*<\/main>/.exec(markup)?.[0] ?? "";
}

describe("renderPage head", () => {
	it.each(LOCALES)("describes the page in %s", (locale) => {
		const markup = renderPage({
			title: "Title",
			body: "",
			page: testPage(locale),
		});
		expect(markup).toContain(
			`<meta name="description" content="${shown("layout.description", locale)}">`,
		);
		expect(markup).toContain(`<html lang="${locale}">`);
	});

	it("takes the English description from brand.config.json", () => {
		expect(testPage("en").i18n.t("layout.description")).toBe(brand.description);
	});

	it("loads the shell's theme script from this origin before any stylesheet, with no inline script or style", () => {
		const markup = page();
		const script = markup.indexOf(
			'<script src="/assets/app-shell/app-shell-enhance.js?v=',
		);
		expect(script).toBeGreaterThan(-1);
		expect(script).toBeLessThan(markup.indexOf('<link rel="stylesheet"'));
		// Every script has a src and no body; nothing carries a style or on* attribute.
		expect(markup.match(/<script\b[^>]*>/g)).toEqual([
			expect.stringMatching(/^<script src="\/assets\/app-shell\//),
		]);
		expect(markup).toMatch(/<script [^>]*><\/script>/);
		expect(markup).not.toMatch(/\sstyle=|<style|\son[a-z]+=/i);
		const sheets = [
			...markup.matchAll(/<link rel="stylesheet" href="([^"?]+)/g),
		]
			.map((match) => match[1])
			.filter((href) => !href?.startsWith("/assets/fonts/"));
		expect(sheets).toEqual([
			"/assets/app-shell/tokens.css",
			"/assets/app-shell/app-shell.css",
			"/assets/css/app.css",
		]);
	});
});

describe("renderPage frame", () => {
	it.each([
		["card", "shell-main shell-container shell-main-center", "card auth-card"],
		[
			"wide",
			"shell-main shell-container shell-main-center",
			"card auth-card auth-card-wide",
		],
		["portal", "shell-main shell-container", "portal"],
	] as const)("puts the %s body in the shell's main", (layout, main, frame) => {
		const markup = page({ layout });
		expect(markup).toContain('data-id="public-header"');
		expect(markup).toContain('data-id="public-footer"');
		expect(markup).toContain('data-id="skip-link"');
		expect(mainOf(markup)).toContain(
			`<main id="main" tabindex="-1" class="${main}"><div class="${frame}"><p data-id="the-body">Body &amp; text</p></div></main>`,
		);
	});

	it("shows the brand, Home in the nav and Account in the account slot, no sign-in pill", () => {
		const markup = page();
		expect(markup).toContain(
			'<a href="/apps" class="shell-brand" data-id="public-home"><img class="shell-brand-mark" src="/assets/img/hoandat-mark-128.webp" width="24" height="24" alt="" aria-hidden="true"/><b class="shell-brand-name">hoandat.com</b></a>',
		);
		expect(markup).toContain(
			'<a href="/apps" class="shell-topbar-link" data-id="nav-home" aria-current="page">Home</a>',
		);
		expect(markup).toContain(
			'<a class="shell-topbar-link" href="/account" data-id="nav-account">Account</a>',
		);
		expect(markup).not.toContain('data-id="public-sign-in"');
	});

	it("puts the signed-in account's menu in the account slot instead of the Account link", () => {
		const markup = page({
			accountMenu: createElement("span", { "data-id": "the-menu" }),
		});
		expect(markup).toContain(
			'<div class="shell-topbar-end"><nav class="shell-topbar-nav" aria-label="Navigation"><a href="/apps" class="shell-topbar-link" data-id="nav-home" aria-current="page">Home</a></nav><span data-id="the-menu"></span></div>',
		);
		expect(markup).not.toContain('data-id="nav-account"');
	});

	it.each(["/account", "/account/delete", "/account?x=1"])(
		"marks Account current on %s",
		(path) => {
			const markup = page({ page: testPage("en", path) });
			expect(markup).toContain(
				'<a class="shell-topbar-link" href="/account" data-id="nav-account" aria-current="page">Account</a>',
			);
			expect(markup).not.toMatch(/data-id="nav-home" aria-current/);
		},
	);

	it("has the home, privacy and no terms link in the footer, and the theme switch for the brand's domain", () => {
		const markup = page();
		expect(markup).toContain('href="https://hoandat.com" data-id="foot-home"');
		expect(markup).toContain(
			'<a href="/privacy" class="shell-foot-link" data-id="foot-privacy">',
		);
		expect(markup).not.toContain('data-id="foot-terms"');
		expect(markup).toMatch(
			/data-id="theme-switch"[^>]*data-domain="hoandat.com"/,
		);
		for (const theme of ["light", "dark", "system"]) {
			expect(markup).toContain(`data-id="theme-${theme}"`);
		}
	});

	it.each(LOCALES)("links every language back to this page in %s", (locale) => {
		const markup = page({ page: testPage(locale, "/account?x=1") });
		for (const option of LOCALES) {
			const query = new URLSearchParams({
				set: option,
				return: "/account?x=1",
			});
			const current = option === locale ? ' aria-current="true"' : "";
			expect(markup).toMatch(
				new RegExp(
					`<a class="shell-lang-option" lang="${option}" data-id="lang-${option}" href="/lang\\?${query
						.toString()
						.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
						.replace(/&/g, "&amp;")}" hrefLang="${option}"${current}>`,
				),
			);
		}
	});
});
