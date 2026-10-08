import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateRecoveryCodes } from "../accounts/recovery-codes.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { TestBrowser } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

// A fresh IdP per test: every test starts with empty per-IP budgets.
let idp: TestIdp;

beforeEach(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterEach(async () => {
	await idp?.close();
});

describe("lockout under parallel requests", () => {
	it("verifies at most 5 of 25 parallel attempts (24 wrong, 1 right)", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const attempts = [
			...Array.from({ length: 24 }, () => "wrong-password"),
			TEST_PASSWORD,
		];
		const statuses = await Promise.all(
			attempts.map(
				async (password) =>
					(await postLogin(idp, page, account.username, password)).status,
			),
		);
		const verified = statuses.filter((status) => status !== 429);
		expect(verified.length).toBeLessThanOrEqual(5);
		expect(
			statuses.filter((status) => status === 429).length,
		).toBeGreaterThanOrEqual(20);
		const right = statuses.at(-1);
		if (right === 429) {
			// Refused like the rest: once locked, the right password is refused too.
			expect(
				(await postLogin(idp, page, account.username, TEST_PASSWORD)).status,
			).toBe(429);
		}
	});

	it("verifies at most 5 of 12 parallel recovery-code guesses", async () => {
		const { hashes } = await generateRecoveryCodes();
		const account = await createTestAccount(repositoryOf(idp), {
			recoveryCodeHashes: [...hashes],
		});
		const page = await openLoginPage(idp);
		const statuses = await Promise.all(
			Array.from({ length: 12 }, async (_, index) => {
				const response = await page.browser.request(
					`${idp.issuer}/interaction/${page.uid}/forgot/recovery`,
					{
						form: {
							csrf: page.csrf,
							identifier: account.username,
							code: `aaaa-aa${String(index).padStart(2, "2")}`,
							password: "new-password-1",
							password_confirm: "new-password-1",
						},
					},
				);
				return response.status;
			}),
		);
		expect(
			statuses.filter((status) => status === 401).length,
		).toBeLessThanOrEqual(5);
		expect(
			statuses.filter((status) => status === 429).length,
		).toBeGreaterThanOrEqual(7);
	});
});

describe("one budget per account", () => {
	it("locks after 5 wrong attempts alternating username and email", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const statuses: number[] = [];
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const identifier =
				attempt % 2 === 0 ? account.username : account.email.toUpperCase();
			statuses.push(
				(await postLogin(idp, page, identifier, "wrong-password")).status,
			);
		}
		expect(statuses).toEqual([
			401, 401, 401, 401, 401, 429, 429, 429, 429, 429,
		]);
	});
});

describe("known devices", () => {
	it("a browser that signed in before is not locked out by someone guessing", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		// The owner signs in once; the browser keeps its signed device cookie.
		const owner = new TestBrowser();
		const first = await openLoginPage(idp, owner);
		expect(
			(await postLogin(idp, first, account.username, TEST_PASSWORD)).status,
		).toBe(303);
		owner.forgetCookies("_session");

		// Someone else burns the account's budget.
		const attacker = await openLoginPage(idp);
		for (let attempt = 0; attempt < 5; attempt += 1) {
			await postLogin(idp, attacker, account.username, "guess");
		}
		expect(
			(await postLogin(idp, attacker, account.username, TEST_PASSWORD)).status,
		).toBe(429);
		const stranger = await openLoginPage(idp);
		expect(
			(await postLogin(idp, stranger, account.username, TEST_PASSWORD)).status,
		).toBe(429);

		const again = await openLoginPage(idp, owner);
		expect(
			(await postLogin(idp, again, account.username, TEST_PASSWORD)).status,
		).toBe(303);
	});
});
