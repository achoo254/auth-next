import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { accountPageStatus, signedInBrowser } from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function get(browser: TestBrowser, path: string): Promise<Response> {
	return browser.request(`${idp.issuer}${path}`);
}

/** Pretends every sign-in of the account happened `seconds` ago. */
async function ageSignIn(account: TestAccount, seconds: number): Promise<void> {
	await idp.db
		.collection(collectionNameFor("Session"))
		.updateMany(
			{ "payload.accountId": account._id },
			{ $inc: { "payload.loginTs": -seconds } },
		);
}

describe("/account buttons say what they do", () => {
	it("labels sign-outs by effect and keeps red for removing an app", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const alone = await (await get(browser, "/account")).text();
		expect(alone).toContain("Sign out this browser");
		expect(alone).toContain('data-id="session-current"');
		expect(alone).not.toContain("Sign out every other session");

		await signedInBrowser(idp, account);
		const page = await (await get(browser, "/account")).text();
		expect(page).toContain("Sign out session");
		expect(page).toContain('href="/account/sessions/revoke-others"');
		// Signing in through localman-web authorized "Localman".
		expect(page).toContain('href="/account/apps/localman-web/revoke"');
		expect(page.match(/btn-danger/g)).toHaveLength(1);
		expect(page).toContain("Remove app access");
		for (const id of [
			"profile",
			"sign-in",
			"sessions",
			"devices",
			"apps",
			"telegram",
		]) {
			expect(page).toContain(`data-id="account-${id}"`);
		}
		expect(page).toContain('data-id="account-devices-empty"');
	});
});

describe("sign out every other session", () => {
	it("asks first, then needs CSRF and a recent sign-in, and records one audit event", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const current = await signedInBrowser(idp, account);
		const others = [
			await signedInBrowser(idp, account),
			await signedInBrowser(idp, account),
		];
		const confirm = await get(current, "/account/sessions/revoke-others");
		expect(confirm.status).toBe(200);
		const html = await confirm.text();
		expect(html).toContain('action="/account/sessions/revoke-others"');
		expect(html).toContain('data-id="sessions-revoke-others-confirm"');
		const csrf = formField(html, "csrf");

		const forged = await current.request(
			`${idp.issuer}/account/sessions/revoke-others`,
			{ form: { csrf: "forged" } },
		);
		expect(forged.headers.get("location")).toBe("/account?notice=expired");

		await ageSignIn(account, 11 * 60);
		const stale = await current.request(
			`${idp.issuer}/account/sessions/revoke-others`,
			{ form: { csrf } },
		);
		const reauth = new URL(stale.headers.get("location") ?? "", idp.issuer);
		expect(reauth.pathname).toBe("/auth");
		expect(reauth.searchParams.get("prompt")).toBe("login");
		for (const other of others) {
			expect(await accountPageStatus(idp, other)).toBe(200);
		}

		await ageSignIn(account, -11 * 60);
		const done = await submitForm(
			current,
			`${idp.issuer}/account/sessions/revoke-others`,
			{ csrf },
		);
		expect(await done.response.text()).toContain(
			"Signed out every other session.",
		);
		expect(await accountPageStatus(idp, current)).toBe(200);
		for (const other of others) {
			expect(await accountPageStatus(idp, other)).toBe(303);
		}
		const events = await auditOutboxCollection(idp.db)
			.find({ sub: account._id, type: "session.revoked" })
			.toArray();
		expect(events.map((event) => event.data)).toEqual([
			{ count: 2, cause: "account-page" },
		]);
	});
});

describe("remove app access", () => {
	it("asks on its own page; the POST needs CSRF and a recent sign-in", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const path = "/account/apps/localman-web/revoke";
		const html = await (await get(browser, path)).text();
		expect(html).toContain("Remove app access?");
		expect(html).toContain('data-id="app-revoke-confirm"');
		expect(html).toContain('class="btn btn-danger btn-block"');
		const csrf = formField(html, "csrf");

		const forged = await browser.request(`${idp.issuer}${path}`, {
			form: { csrf: "forged" },
		});
		expect(forged.headers.get("location")).toBe("/account?notice=expired");

		await ageSignIn(account, 11 * 60);
		const stale = await browser.request(`${idp.issuer}${path}`, {
			form: { csrf },
		});
		expect(
			new URL(stale.headers.get("location") ?? "", idp.issuer).searchParams.get(
				"prompt",
			),
		).toBe("login");

		await ageSignIn(account, -11 * 60);
		const done = await submitForm(browser, `${idp.issuer}${path}`, { csrf });
		expect(await done.response.text()).toContain(shown("notice.appRevoked"));
		const revoked = await auditOutboxCollection(idp.db).findOne({
			sub: account._id,
			type: "grant.revoked",
		});
		expect(revoked?.data).toMatchObject({
			cause: "account-page",
			clientId: "localman-web",
		});
	});

	it("sends an unknown app back to /account", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const response = await get(browser, "/account/apps/nobody/revoke");
		expect(response.headers.get("location")).toBe("/account?notice=not-found");
	});
});
