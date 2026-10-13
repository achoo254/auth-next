import type { KoaContextWithOIDC } from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { createRotateAndSlideGrant } from "../oidc/sliding-grants.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
		formPostsPerMinute: 4,
	});
});

afterAll(async () => {
	await idp?.close();
});

describe("smaller hardening", () => {
	it("never re-creates a grant revoked while a refresh was in flight", async () => {
		const slide = createRotateAndSlideGrant(idp.services);
		const now = Math.floor(Date.now() / 1000);
		const grant = {
			iat: now - 60,
			exp: now + 60,
			jti: "grant-already-revoked",
		};
		// Only the fields the hook reads; a full oidc-provider context is not needed.
		const ctx = {
			oidc: { entities: { Grant: grant } },
		} as unknown as KoaContextWithOIDC;
		expect(await slide(ctx)).toBe(true);
		expect(
			await idp.db.collection(collectionNameFor("Grant")).countDocuments({}),
		).toBe(0);
		expect(grant.exp).toBe(now + 60);
	});

	it("ignores ?notice= values that are not known notices", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await repositoryOf(idp).links.setTelegram(account._id, {
			chatId: "77",
			username: "dat_tg",
			name: "Đạt",
		});
		const browser = await signedInBrowser(idp, account);
		for (const notice of ["constructor", "__proto__", "toString"]) {
			const page = await (
				await browser.request(`${idp.issuer}/account?notice=${notice}`)
			).text();
			expect(page).not.toContain('role="alert"');
			expect(page).not.toContain('role="status"');
		}
		const page = await (await browser.request(`${idp.issuer}/account`)).text();
		expect(page).toContain("@dat_tg · Đạt");
	});

	it("clears the OAuth state cookie with the attributes it was set with", async () => {
		const page = await openLoginPage(idp);
		const start = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/upstream/google`,
		);
		expect(start.headers.getSetCookie().join("\n")).toMatch(
			/upstream_state=.*HttpOnly.*SameSite=Lax/i,
		);
		idp.fake.nextLogins.push({
			id: "g-cookie",
			email: "cookie@example.com",
			emailVerified: true,
		});
		const authorize = await fetch(start.headers.get("location") ?? "", {
			redirect: "manual",
		});
		const callback = await page.browser.request(
			authorize.headers.get("location") ?? "",
		);
		const cleared = callback.headers
			.getSetCookie()
			.find((cookie) => cookie.startsWith("upstream_state="));
		expect(cleared).toMatch(/Path=\//);
		expect(cleared).toMatch(/HttpOnly/i);
		expect(cleared).toMatch(/SameSite=Lax/i);
		expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
	});

	it("rate-limits starting a Google/GitHub sign-in", async () => {
		const page = await openLoginPage(idp);
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 6; attempt += 1) {
			statuses.push(
				(
					await page.browser.request(
						`${idp.issuer}/interaction/${page.uid}/upstream/github`,
					)
				).status,
			);
		}
		expect(statuses.slice(0, 2)).toEqual([303, 303]);
		expect(statuses).toContain(429);
	});
});
