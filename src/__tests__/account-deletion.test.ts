import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	deleteAccount,
	finishAccountDeletion,
} from "../account-portal/account-deletion.js";
import { decideUpstreamLogin } from "../accounts/account-linking.js";
import { accountsCollection } from "../accounts/user-model.js";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { TENANT_COLLECTIONS } from "../tenants/tenant-collections.js";
import { sharedFakeApple } from "./helpers/fake-apple.js";
import { FAKE_UPSTREAM_ENV } from "./helpers/fake-upstreams.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import {
	type TestAccount,
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown } from "./helpers/test-page.js";

const apple = sharedFakeApple();
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		rateLimits: [],
		env: { ...FAKE_UPSTREAM_ENV, ...apple.env },
	});
});

afterAll(async () => {
	await idp?.close();
});

const DELETE_URL = (): string => `${idp.issuer}/account/delete`;

async function deleteCsrf(browser: TestBrowser): Promise<string> {
	const page = await browser.request(DELETE_URL());
	expect(page.status).toBe(200);
	return formField(await page.text(), "csrf");
}

/** Documents of the tenant still pointing at `accountId`, per collection. */
async function leftovers(
	accountId: string,
	grantIds: readonly string[],
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	for (const name of TENANT_COLLECTIONS) {
		if (name === "audit_outbox") continue;
		const count = await idp.db
			.collection<{ _id: string }>(name)
			.countDocuments({
				tenantId: idp.tenant.id,
				$or: [
					{ _id: accountId },
					{ _id: { $in: [...grantIds] } },
					{ accountId },
					{ sub: accountId },
					{ grantId: { $in: [...grantIds] } },
					{ "payload.accountId": accountId },
					{ "payload.session.accountId": accountId },
					{ "data.accountId": accountId },
				],
			});
		if (count > 0) counts[name] = count;
	}
	return counts;
}

async function grantIdsOf(accountId: string): Promise<string[]> {
	const grants = await idp.db
		.collection<{ _id: string }>(collectionNameFor("Grant"))
		.find({ "payload.accountId": accountId })
		.toArray();
	return grants.map((grant) => grant._id);
}

async function withAppleLink(account: TestAccount): Promise<void> {
	await accountsCollection(idp.db).updateOne(
		{ _id: account._id },
		{
			$set: {
				"providers.apple": `001.del.${account._id}`,
				"providerDetails.apple.revocationToken": `apple-rt.${account._id}`,
			},
		},
	);
}

describe("delete my account at /account", () => {
	it("asks first; the POST needs CSRF, a recent sign-in and the username", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const overview = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		expect(overview).toContain('href="/account/delete"');
		const confirm = await (await browser.request(DELETE_URL())).text();
		expect(confirm).toContain('data-id="account-delete-confirm"');
		expect(confirm).toContain(`@${account.username}`);
		const csrf = formField(confirm, "csrf");

		const forged = await browser.request(DELETE_URL(), {
			form: { csrf: "forged", username: account.username },
		});
		expect(forged.headers.get("location")).toBe("/account?notice=expired");

		await idp.db
			.collection(collectionNameFor("Session"))
			.updateMany(
				{ "payload.accountId": account._id },
				{ $inc: { "payload.loginTs": -11 * 60 } },
			);
		const stale = await browser.request(DELETE_URL(), {
			form: { csrf, username: account.username },
		});
		expect(
			new URL(stale.headers.get("location") ?? "", idp.issuer).searchParams.get(
				"prompt",
			),
		).toBe("login");
		await idp.db
			.collection(collectionNameFor("Session"))
			.updateMany(
				{ "payload.accountId": account._id },
				{ $inc: { "payload.loginTs": 11 * 60 } },
			);

		const mismatch = await submitForm(browser, DELETE_URL(), {
			csrf,
			username: "someone_else",
		});
		expect(await mismatch.response.text()).toContain(
			shown("notice.deleteMismatch"),
		);
		expect(await repositoryOf(idp).findActiveById(account._id)).toBeDefined();
	});

	it("leaves nothing of the account behind, and nothing of another one is touched", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await withAppleLink(account);
		const other = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const secondBrowser = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, browser);
		const otherBrowser = await signedInBrowser(idp, other);
		const grants = await grantIdsOf(account._id);
		expect(grants.length).toBeGreaterThanOrEqual(2);
		expect(await leftovers(account._id, grants)).toMatchObject({
			client_usage: expect.any(Number),
		});
		const otherLeftBefore = await leftovers(
			other._id,
			await grantIdsOf(other._id),
		);
		// The same account id in another tenant is not this account.
		const foreign = idp.db.collection<{
			_id: string;
			tenantId: string;
			accountId: string;
		}>("session_meta");
		await foreign.insertOne({
			_id: `foreign-${account._id}`,
			tenantId: "t_elsewhere",
			accountId: account._id,
		});

		const done = await submitForm(browser, DELETE_URL(), {
			csrf: await deleteCsrf(browser),
			username: `@${account.username.toUpperCase()}`,
		});
		expect(await done.response.text()).toContain('data-id="account-deleted"');

		expect(await leftovers(account._id, grants)).toEqual({});
		expect(apple.revoked).toContain(`apple-rt.${account._id}`);
		expect(await accountPageStatus(idp, secondBrowser)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toThrow();
		const events = await auditOutboxCollection(idp.db)
			.find({ sub: account._id })
			.sort({ occurredAt: 1 })
			.toArray();
		expect(events.some((event) => event.context !== undefined)).toBe(false);
		expect(events.some((event) => "deviceName" in event.data)).toBe(false);
		expect(
			await auditOutboxCollection(idp.db).countDocuments({
				sub: other._id,
				context: { $exists: true },
			}),
		).toBeGreaterThan(0);
		expect(
			await foreign.countDocuments({ _id: `foreign-${account._id}` }),
		).toBe(1);
		// A second click finds nothing left to delete and records nothing.
		expect(await deleteAccount(idp.services, account._id, "web")).toBe(
			"not-found",
		);
		expect(
			await auditOutboxCollection(idp.db).countDocuments({
				sub: account._id,
				type: "account.deleted",
			}),
		).toBe(1);
		expect(events.at(-1)).toMatchObject({
			type: "account.deleted",
			data: { source: "web" },
		});
		const google = account.providers.google ?? "";
		const again = await decideUpstreamLogin(repositoryOf(idp), {
			provider: "google",
			providerId: google,
			verifiedEmail: account.email,
		});
		expect(again.kind).toBe("signup");

		expect(await accountPageStatus(idp, otherBrowser)).toBe(200);
		expect(await leftovers(other._id, await grantIdsOf(other._id))).toEqual(
			otherLeftBefore,
		);
	});
});

describe("finishing a deletion that stopped half way", () => {
	it("removes the disabled account, and can run twice", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		expect(await accounts.disable(account._id)).toBe("disabled");
		expect(await accounts.findActiveById(account._id)).toBeUndefined();
		expect(await accounts.disable(account._id)).toBe("was-disabled");

		const deps = { db: idp.db, tenant: idp.tenant, accounts };
		const first = await finishAccountDeletion(deps, account._id);
		expect(first).toContainEqual({ collection: "accounts", count: 1 });
		const second = await finishAccountDeletion(deps, account._id);
		expect(second.every(({ count }) => count === 0)).toBe(true);
		expect(await accounts.disable(account._id)).toBe("missing");
	});

	it("never deletes an account that is still in use", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		expect(await accounts.deleteDisabled(account._id)).toBe(false);
		await expect(
			finishAccountDeletion(
				{ db: idp.db, tenant: idp.tenant, accounts },
				account._id,
			),
		).rejects.toThrow(/still in use/);
		expect(await accounts.findActiveById(account._id)).toBeDefined();
	});
});
