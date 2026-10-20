import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashReviewPassword } from "../accounts/review-password-hash.js";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	type LoginPage,
	createTestAccount,
	openLoginPage,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";

const PASSWORD = "correct horse battery staple";
const EMAIL = "app.review@example.com";

let dir: string;
let hashPath: string;
let idp: TestIdp;

function reviewEnv(email: string): Record<string, string> {
	return {
		REVIEW_LOGIN_EMAIL: email,
		REVIEW_LOGIN_PASSWORD_HASH_PATH: hashPath,
	};
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "hoandat-auth-review-login-"));
	hashPath = join(dir, "review-login.hash");
	await writeFile(hashPath, await hashReviewPassword(PASSWORD), {
		mode: 0o600,
	});
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: reviewEnv(" App.Review@Example.com "),
	});
});

afterAll(async () => {
	await idp?.close();
	await rm(dir, { recursive: true, force: true });
});

/** Login page → the reviewer link → the form; returns its CSRF token. */
async function openReviewForm(
	target: TestIdp,
): Promise<{ page: LoginPage; csrf: string; url: string }> {
	const page = await openLoginPage(target);
	const url = `${target.issuer}/interaction/${page.uid}/review`;
	expect(page.html).toContain(`href="/interaction/${page.uid}/review"`);
	const form = await page.browser.request(url);
	const html = await form.text();
	expect(html).toContain('type="password"');
	return { page, url, csrf: formField(html, "csrf") };
}

function submit(
	page: LoginPage,
	url: string,
	form: Record<string, string>,
): ReturnType<LoginPage["browser"]["navigate"]> {
	return page.browser.navigate(url, { form }, LOCALMAN_CALLBACK);
}

/** Data of the failed sign-ins recorded for `sub`. */
async function failuresOf(sub: string): Promise<unknown[]> {
	const events = await auditOutboxCollection(idp.db)
		.find({ sub, type: "login.failed" })
		.toArray();
	return events.map((event) => event.data);
}

describe("review-only password sign-in", () => {
	it("shows a discreet link and signs the configured account in, creating it once", async () => {
		const ids: unknown[] = [];
		for (const email of ["APP.review@example.com", EMAIL]) {
			const { page, csrf, url } = await openReviewForm(idp);
			expect(page.html).toContain(shown("review.link"));
			const done = await submit(page, url, { csrf, email, password: PASSWORD });
			expect(done.location?.searchParams.get("code")).toEqual(
				expect.any(String),
			);
			ids.push((await repositoryOf(idp).findByEmail(EMAIL))?._id);
		}
		const account = await repositoryOf(idp).findByEmail(EMAIL);
		expect(ids).toEqual([account?._id, account?._id]);
		expect(account).toMatchObject({
			tenantId: idp.tenant.id,
			username: "app_review",
			name: "App Review",
			emailVerifiedBy: null,
			providers: {},
			reviewLogin: true,
		});
		const logins = await auditOutboxCollection(idp.db)
			.find({ sub: account?._id, type: "login.succeeded" })
			.toArray();
		expect(logins.map((event) => event.data)).toEqual([
			{ methods: ["pwd", "review"] },
			{ methods: ["pwd", "review"] },
		]);
	});

	it("answers a wrong password or email with the same generic error", async () => {
		const account = await repositoryOf(idp).findByEmail(EMAIL);
		for (const [email, password] of [
			[EMAIL, "wrong password value"],
			["someone@example.com", PASSWORD],
		] as const) {
			const { page, csrf, url } = await openReviewForm(idp);
			const { response, location } = await submit(page, url, {
				csrf,
				email,
				password,
			});
			expect(location).toBeUndefined();
			expect(response.status).toBe(401);
			const html = await response.text();
			expect(html).toContain(shown("review.failed"));
			expect(html).not.toContain(password);
		}
		expect(await failuresOf(account?._id ?? "")).toEqual([
			{ method: "review", reason: "wrong-password" },
		]);
		expect(await failuresOf("review-login")).toEqual([
			{ method: "review", reason: "unknown-email" },
		]);
	});

	it("requires the interaction's CSRF token", async () => {
		const { page, url } = await openReviewForm(idp);
		const response = await page.browser.request(url, {
			form: { email: EMAIL, password: PASSWORD },
		});
		expect(response.status).toBe(403);
	});
});

describe("review-only sign-in limits", () => {
	it("never opens a regular account with the email, and rate-limits failures per IP", async () => {
		const limited = await startTestIdp({
			interactions: "real",
			rateLimits: [],
			env: reviewEnv("owner@example.com"),
		});
		try {
			const owner = await createTestAccount(repositoryOf(limited), {
				email: "owner@example.com",
				emailVerifiedBy: "google",
			});
			const { page, csrf, url } = await openReviewForm(limited);
			const refused = await submit(page, url, {
				csrf,
				email: "owner@example.com",
				password: PASSWORD,
			});
			expect(refused.response.status).toBe(401);
			expect(
				await limited.db
					.collection("oidc_session")
					.countDocuments({ "payload.accountId": owner._id }),
			).toBe(0);
			const statuses: number[] = [];
			for (let attempt = 0; attempt < 5; attempt += 1) {
				const response = await page.browser.request(url, {
					form: { csrf, email: "owner@example.com", password: "nope nope" },
				});
				statuses.push(response.status);
			}
			expect(statuses).toEqual([401, 401, 401, 401, 429]);
		} finally {
			await limited.close();
		}
	});

	it("is absent when not configured: no link, and its routes answer 404", async () => {
		const off = await startTestIdp({ interactions: "real", rateLimits: [] });
		try {
			const page = await openLoginPage(off);
			expect(page.html).not.toContain(`/interaction/${page.uid}/review`);
			const url = `${off.issuer}/interaction/${page.uid}/review`;
			expect((await page.browser.request(url)).status).toBe(404);
			const posted = await page.browser.request(url, {
				form: { csrf: page.csrf, email: EMAIL, password: PASSWORD },
			});
			expect(posted.status).toBe(404);
		} finally {
			await off.close();
		}
	});
});
