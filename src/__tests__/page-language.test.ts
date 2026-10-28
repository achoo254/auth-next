import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openLoginPage } from "./helpers/test-accounts.js";
import { TestBrowser } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function langOf(html: string): string | undefined {
	return /<html lang="([^"]+)">/.exec(html)?.[1];
}

function switchTo(locale: string, back: string): Promise<Response> {
	const query = new URLSearchParams({ set: locale, return: back });
	return fetch(`${idp.issuer}/lang?${query.toString()}`, {
		redirect: "manual",
	});
}

describe("GET /lang", () => {
	it("remembers the language and goes back to the page", async () => {
		const response = await switchTo("zh-CN", "/privacy?x=1");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/privacy?x=1");
		const [cookie = ""] = response.headers.getSetCookie();
		expect(cookie).toMatch(/^hd_lang=zh-CN;/);
		expect(cookie).toMatch(/Path=\//);
		expect(cookie).toMatch(/SameSite=Lax/);
		// Shared with the apps' own switches, which read it from script.
		expect(cookie).not.toMatch(/HttpOnly/);
	});

	it("scopes a pick made during a sign-in to that sign-in's path", async () => {
		const response = await switchTo("vi", "/interaction/abc_1-2/login");
		const cookies = response.headers.getSetCookie();
		expect(cookies.some((c) => /^hd_lang=vi;.*Path=\/;/.test(c))).toBe(true);
		expect(
			cookies.some((c) =>
				/^hd_lang_interaction=vi;.*Path=\/interaction\/abc_1-2;/.test(c),
			),
		).toBe(true);
	});

	it.each([
		"//evil.example/",
		"/\\evil.example",
		"https://evil.example/",
		"javascript:alert(1)",
		"/%0d%0a/evil\r\n",
		"/lang?set=en&return=//evil.example",
	])("never sends the browser off-site for return=%j", async (back) => {
		const response = await switchTo("en", back);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/account");
	});

	it("ignores an unknown language", async () => {
		const response = await switchTo("fr", "/privacy");
		expect(response.headers.get("location")).toBe("/privacy");
		expect(response.headers.getSetCookie()).toEqual([]);
	});
});

describe("page language", () => {
	it("follows the cookie, then Accept-Language, then English", async () => {
		const privacy = (headers: Record<string, string>) =>
			fetch(`${idp.issuer}/privacy`, { headers }).then((r) => r.text());
		expect(langOf(await privacy({}))).toBe("en");
		expect(langOf(await privacy({ "accept-language": "zh-TW,en;q=0.5" }))).toBe(
			"zh-CN",
		);
		expect(
			langOf(await privacy({ "accept-language": "zh", cookie: "hd_lang=vi" })),
		).toBe("vi");
	});

	it("takes the newest hd_lang when an old host-only one is sent as well", async () => {
		// Same path: the browser sends the older (host-only) cookie first.
		const html = await fetch(`${idp.issuer}/privacy`, {
			headers: { cookie: "hd_lang=vi; hd_lang=zh-CN; hd_lang=xx" },
		}).then((r) => r.text());
		expect(langOf(html)).toBe("zh-CN");
	});

	it("uses the app's ui_locales over the cookie, until the user switches on that sign-in", async () => {
		const browser = new TestBrowser();
		// The browser picked Vietnamese earlier, on another page.
		await browser.request(`${idp.issuer}/lang?set=vi&return=%2Faccount`);
		const login = await openLoginPage(idp, browser, { ui_locales: "zh-CN" });
		expect(langOf(login.html)).toBe("zh-CN");
		expect(login.html).toContain("登录以继续使用 Localman");
		expect(login.html).toContain("使用 Google 登录");

		const back = `/interaction/${login.uid}`;
		const switched = await browser.navigate(
			`${idp.issuer}/lang?set=en&return=${encodeURIComponent(back)}`,
		);
		const html = await switched.response.text();
		expect(langOf(html)).toBe("en");
		expect(html).toContain("Sign in to continue to Localman");
	});
});
