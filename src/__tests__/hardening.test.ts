import type { KoaContextWithOIDC } from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { createRotateAndSlideGrant } from "../oidc/sliding-grants.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import {
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

let idp: TestIdp;
const fake = new FakeUpstreams();
let uninstall: () => void;

beforeAll(async () => {
	uninstall = fake.install();
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
		formPostsPerMinute: 4,
	});
});

afterAll(async () => {
	uninstall?.();
	await idp?.close();
});

describe("smaller hardening", () => {
	it("never re-creates a grant revoked while a refresh was in flight", async () => {
		const slide = createRotateAndSlideGrant(idp.db);
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

	it("names the taken field on sign-up and logs in only after the codes are saved", async () => {
		const existing = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const signup = (fields: Record<string, string>) =>
			page.browser.request(`${idp.issuer}/interaction/${page.uid}/signup`, {
				form: {
					csrf: page.csrf,
					password: "1234567",
					password_confirm: "1234567",
					...fields,
				},
			});
		const email = await signup({
			email: existing.email.toUpperCase(),
			username: "brand_new_one",
		});
		expect(email.status).toBe(409);
		expect(await email.text()).toContain("Email này đã có tài khoản");
		const username = await signup({
			email: "fresh@example.com",
			username: existing.username,
		});
		expect(await username.text()).toContain("Username này đã có người dùng");

		const created = await signup({
			email: "fresh@example.com",
			username: "fresh_user",
		});
		expect(created.status).toBe(200);
		// Resuming without confirming does not sign anyone in.
		const resumed = await page.browser.navigate(
			`${idp.issuer}/auth/${page.uid}`,
			{},
			LOCALMAN_CALLBACK,
		);
		expect(resumed.location).toBeUndefined();
		expect(await resumed.response.text()).toContain('name="password"');
	});

	it("clears the OAuth state cookie with the attributes it was set with", async () => {
		const page = await openLoginPage(idp);
		const start = await page.browser.request(
			`${idp.issuer}/interaction/${page.uid}/upstream/google`,
		);
		expect(start.headers.getSetCookie().join("\n")).toMatch(
			/upstream_state=.*HttpOnly.*SameSite=Lax/i,
		);
		fake.nextLogins.push({
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
