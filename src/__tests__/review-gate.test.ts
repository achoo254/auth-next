import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONE_TIME_TOKENS_COLLECTION } from "../accounts/one-time-tokens.js";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { REVIEW_NEEDS_PASSWORD_MESSAGE } from "../interactions/security-review-routes.js";
import { createPasswordResetToken } from "../telegram/reset-link-service.js";
import { FAKE_UPSTREAM_ENV, FakeUpstreams } from "./helpers/fake-upstreams.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	type TestAccount,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { signInWith } from "./helpers/upstream-sign-in.js";

let idp: TestIdp;
const fake = new FakeUpstreams();
let uninstall: () => void;

beforeAll(async () => {
	uninstall = fake.install();
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: FAKE_UPSTREAM_ENV,
	});
});

afterAll(async () => {
	uninstall?.();
	await idp?.close();
});

/** The owner resets through a reset link; returns the browser that did it. */
async function ownerResets(
	account: TestAccount,
): Promise<{ owner: TestBrowser; page: string }> {
	const token = await createPasswordResetToken(idp.services.accountTokens, {
		accountId: account._id,
	});
	const owner = new TestBrowser();
	const form = await (
		await owner.request(`${idp.issuer}/reset/${token}`)
	).text();
	const done = await submitForm(owner, `${idp.issuer}/reset/${token}`, {
		csrf: formField(form, "csrf"),
		password: "only-the-owner-knows",
		password_confirm: "only-the-owner-knows",
	});
	expect(done.response.url).toBe(`${idp.issuer}/reset/review`);
	return { owner, page: await done.response.text() };
}

describe("a pending security review only opens with the new password", () => {
	it("refuses the intruder's Google sign-in and lets the owner review", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.linkProvider(account, {
			provider: "google",
			providerId: "g-intruder",
			verifiedEmail: "intruder@gmail.com",
		});
		const codesBefore = (await accounts.findActiveById(account._id))
			?.recoveryCodeHashes;
		const { owner, page: ownerReview } = await ownerResets(account);
		expect(ownerReview).toContain("intruder@gmail.com");

		// The intruder signs in with the Google account they linked.
		const intruder = await signInWith(idp, fake, "google", {
			id: "g-intruder",
			email: "intruder@gmail.com",
			emailVerified: true,
		});
		expect(intruder.response.status).toBe(403);
		expect(await intruder.response.text()).toContain(
			REVIEW_NEEDS_PASSWORD_MESSAGE,
		);
		const refused = {
			sub: account._id,
			type: "login.failed",
			"data.method": "federated",
			"data.reason": "review-pending",
			"data.provider": "google",
		} as const;
		await expect
			.poll(() => auditOutboxCollection(idp.db).countDocuments(refused))
			.toBe(1);
		const base = `${idp.issuer}/interaction/${intruder.page.uid}/review`;
		const review = await intruder.page.browser.request(base);
		expect(review.status).toBe(303);
		const csrf = intruder.page.csrf;
		for (const action of ["recovery-codes", "unlink/google", "done"]) {
			const response = await intruder.page.browser.request(
				`${base}/${action}`,
				{ form: { csrf } },
			);
			expect(response.status, action).toBe(303);
			expect(response.headers.get("location"), action).toBe(
				`/interaction/${intruder.page.uid}`,
			);
		}
		// Nor can they reach the review of the reset browser.
		expect(
			(await intruder.page.browser.request(`${idp.issuer}/reset/review`))
				.status,
		).toBe(403);
		const stillPending = await accounts.findActiveById(account._id);
		expect(stillPending?.securityReviewPendingSince).toBeDefined();
		expect(stillPending?.recoveryCodeHashes).toEqual(codesBefore);

		// The owner, in the browser that reset, removes Google and confirms.
		const ownerCsrf = formField(ownerReview, "csrf");
		await submitForm(owner, `${idp.issuer}/reset/review/unlink/google`, {
			csrf: ownerCsrf,
		});
		const finished = await submitForm(
			owner,
			`${idp.issuer}/reset/review/done`,
			{ csrf: ownerCsrf },
		);
		expect(await finished.response.text()).toContain("Đã rà soát xong");
		const reviewed = await accounts.findActiveById(account._id);
		expect(reviewed?.securityReviewPendingSince).toBeUndefined();
		expect(reviewed?.providers.google).toBeUndefined();
	});

	it("does not auto-link a provider while the review is pending", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts, {
			emailVerifiedBy: "google",
		});
		await ownerResets(account);
		const intruder = await signInWith(idp, fake, "github", {
			id: "4242",
			email: account.email,
			emailVerified: true,
		});
		expect(intruder.response.status).toBe(403);
		expect(
			(await accounts.findActiveById(account._id))?.providers.github,
		).toBeUndefined();
	});

	it("revokes one-time tokens by account through an index", async () => {
		const indexes = await idp.db
			.collection(ONE_TIME_TOKENS_COLLECTION)
			.indexes();
		expect(
			indexes.some(
				(index) => JSON.stringify(index.key) === '{"data.accountId":1}',
			),
		).toBe(true);
	});

	it("finishing the review signs out sessions and grants that slipped in", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		// A session and a device grant that exist while the review is pending
		// (e.g. a sign-in that raced the reset).
		const slipped = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, slipped);
		await accounts.setSecurityReviewPending(account._id, true);

		const page = await openLoginPage(idp);
		const login = await postLogin(idp, page, account.username, TEST_PASSWORD);
		expect(login.headers.get("location")).toBe(
			`/interaction/${page.uid}/review`,
		);
		const review = await (
			await page.browser.request(`${idp.issuer}/interaction/${page.uid}/review`)
		).text();
		const done = await submitForm(
			page.browser,
			`${idp.issuer}/interaction/${page.uid}/review/done`,
			{ csrf: formField(review, "csrf") },
			LOCALMAN_CALLBACK,
		);
		expect(done.location?.href.startsWith(LOCALMAN_CALLBACK)).toBe(true);
		expect(await accountPageStatus(idp, slipped)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});
});
