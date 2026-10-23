import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT } from "./helpers/test-tenant.js";

const APP_ID = "A1B2C3D4E5.com.example.account";
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "auto",
		rateLimits: [],
		env: { IOS_APP_ID: APP_ID },
	});
});

afterAll(async () => {
	await idp?.close();
});

describe("apple-app-site-association", () => {
	it("lists the app for applinks on /ios/* and for webcredentials, as JSON without redirect", async () => {
		const answer = await fetch(
			`${idp.issuer}/.well-known/apple-app-site-association`,
			{ redirect: "manual" },
		);
		expect(answer.status).toBe(200);
		expect(answer.headers.get("content-type")).toMatch(/^application\/json/);
		expect(await answer.json()).toEqual({
			applinks: {
				details: [
					{
						appIDs: [APP_ID],
						components: [{ "/": "/ios/callback" }, { "/": "/ios/linked" }],
					},
				],
			},
			webcredentials: { apps: [APP_ID] },
		});
	});

	it("is 404 without IOS_APP_ID, and on other tenants", async () => {
		for (const options of [
			{},
			{ tenant: OTHER_TEST_TENANT, env: { IOS_APP_ID: APP_ID } },
		]) {
			const other = await startTestIdp({
				interactions: "auto",
				rateLimits: [],
				...options,
			});
			try {
				const answer = await fetch(
					`${other.issuer}/.well-known/apple-app-site-association`,
				);
				expect(answer.status).toBe(404);
			} finally {
				await other.close();
			}
		}
	});

	it("refuses a malformed IOS_APP_ID at startup", async () => {
		await expect(
			startTestIdp({
				interactions: "auto",
				env: { IOS_APP_ID: "com.example.account" },
			}),
		).rejects.toThrow(/IOS_APP_ID/);
	});
});

describe("/ios/callback and /ios/linked in a browser", () => {
	it("only say to go back to the app, uncached and without referrer", async () => {
		for (const path of [
			"/ios/callback?code=abc&state=x",
			"/ios/linked?result=linked",
		]) {
			const answer = await fetch(`${idp.issuer}${path}`);
			expect(answer.status, path).toBe(200);
			expect(answer.headers.get("cache-control"), path).toBe("no-store");
			expect(answer.headers.get("referrer-policy"), path).toBe("no-referrer");
			const page = await answer.text();
			expect(page).toContain('data-id="ios-open-app"');
			expect(page).not.toContain("abc");
		}
	});
});
