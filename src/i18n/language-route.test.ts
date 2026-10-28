import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { PRIMARY_TEST_TENANT } from "../__tests__/helpers/test-tenant.js";
import { createLanguageRouter, safeReturnPath } from "./language-route.js";

const ISSUER = "https://auth.example.test";

describe("language switcher return path", () => {
	it("keeps same-origin paths with their query", () => {
		expect(safeReturnPath("/account", ISSUER)).toBe("/account");
		expect(safeReturnPath("/interaction/abc-1?x=1#h", ISSUER)).toBe(
			"/interaction/abc-1?x=1",
		);
		expect(safeReturnPath("/device?user_code=ABCD-EFGH", ISSUER)).toBe(
			"/device?user_code=ABCD-EFGH",
		);
	});

	it.each([
		undefined,
		"",
		"account",
		"//evil.example",
		"///evil.example",
		"/\\evil.example",
		"/\\/evil.example",
		"\\\\evil.example",
		"https://evil.example/",
		"javascript:alert(1)",
		"/\t/evil.example",
		"/x\r\nSet-Cookie: a=b",
		"/lang?set=vi&return=/account",
		"/LANG/",
		`/${"a".repeat(2100)}`,
	])("refuses %j", (raw) => {
		expect(safeReturnPath(raw, ISSUER)).toBeUndefined();
	});
});

describe("language switcher cookie", () => {
	let server: Server | undefined;

	afterEach(async () => {
		server?.closeAllConnections();
		await new Promise<void>(
			(resolve) => server?.close(() => resolve()) ?? resolve(),
		);
		server = undefined;
	});

	/** The switcher alone, as the IdP at `issuer` mounts it. */
	async function switcher(issuer: string): Promise<string> {
		const app = express();
		app.use(
			createLanguageRouter({
				issuer,
				tenant: { ...PRIMARY_TEST_TENANT, issuer },
				formPostsPerMinute: 1_000,
			}),
		);
		const listening = app.listen(0, "127.0.0.1");
		server = listening;
		await new Promise<void>((resolve) => listening.once("listening", resolve));
		return `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
	}

	async function pick(issuer: string, back: string): Promise<string[]> {
		const base = await switcher(issuer);
		const query = new URLSearchParams({ set: "zh-CN", return: back });
		const response = await fetch(`${base}/lang?${query.toString()}`, {
			redirect: "manual",
		});
		expect(response.status).toBe(303);
		return response.headers.getSetCookie();
	}

	it("shares hd_lang with every app of the brand: root domain, readable by script", async () => {
		const cookies = await pick("https://auth.hoandat.com", "/account");
		const shared = cookies.find((c) => c.startsWith("hd_lang=zh-CN;"));
		expect(shared).toBeDefined();
		expect(shared).toMatch(/; Domain=hoandat\.com(;|$)/);
		expect(shared).toMatch(/; Path=\/(;|$)/);
		expect(shared).toMatch(/; Max-Age=31536000(;|$)/);
		expect(shared).toMatch(/; Secure(;|$)/);
		expect(shared).toMatch(/; SameSite=Lax(;|$)/);
		expect(shared).not.toMatch(/HttpOnly/i);
		// The host-only HttpOnly cookie of earlier releases is cleared first.
		const cleared = cookies.find(
			(c) => c.startsWith("hd_lang=;") && !/Domain=/i.test(c),
		);
		expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
		expect(cookies.indexOf(cleared ?? "")).toBeLessThan(
			cookies.indexOf(shared ?? ""),
		);
	});

	it("keeps the interaction cookie HttpOnly and on the sign-in's path only", async () => {
		const cookies = await pick(
			"https://auth.hoandat.com",
			"/interaction/abc_1-2/login",
		);
		const scoped = cookies.find((c) => c.startsWith("hd_lang_interaction="));
		expect(scoped).toMatch(/; Path=\/interaction\/abc_1-2(;|$)/);
		expect(scoped).toMatch(/HttpOnly/);
		expect(scoped).not.toMatch(/Domain=/i);
	});

	it("sets a host-only cookie when the IdP is not under the brand's domain", async () => {
		const cookies = await pick("http://127.0.0.1:4590", "/account");
		expect(cookies).toHaveLength(1);
		expect(cookies[0]).toMatch(/^hd_lang=zh-CN;/);
		expect(cookies[0]).not.toMatch(/Domain=|Secure|HttpOnly/i);
	});
});
