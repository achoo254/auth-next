import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function accountPage(browser: TestBrowser): Promise<string> {
	return (await browser.request(`${idp.issuer}/account`)).text();
}

/** The uid of the session `browser` itself is signed in with ("Phiên này"). */
function ownSessionUid(page: string): string {
	const uid =
		/data-id="session-([\w-]+)">\s*<div><b>[^<]*<\/b> <span class="badge badge-primary">Phiên này/.exec(
			page,
		)?.[1];
	if (!uid) throw new Error("no current session on the page");
	return uid;
}

describe("/account revokes what the owner picks", () => {
	it("signs another browser out", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const current = await signedInBrowser(idp, account);
		const other = await signedInBrowser(idp, account);
		const otherUid = ownSessionUid(await accountPage(other));

		const page = await accountPage(current);
		expect(page).toContain(`/account/sessions/${otherUid}/revoke`);
		const done = await submitForm(
			current,
			`${idp.issuer}/account/sessions/${otherUid}/revoke`,
			{ csrf: formField(page, "csrf") },
		);
		expect(await done.response.text()).toContain("Đã thu hồi phiên");
		expect(await accountPageStatus(idp, current)).toBe(200);
		expect(await accountPageStatus(idp, other)).toBe(303);
		const revoked = await auditOutboxCollection(idp.db).findOne({
			sub: account._id,
			type: "session.revoked",
		});
		expect(revoked?.data).toEqual({ count: 1, cause: "account-page" });
	});

	it("takes every grant away from an app", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, browser);
		const done = await submitForm(
			browser,
			`${idp.issuer}/account/apps/tunelo-cli/revoke`,
			{ csrf: formField(await accountPage(browser), "csrf") },
		);
		expect(await done.response.text()).toContain(
			"Đã thu hồi quyền của ứng dụng",
		);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
		// The browser session itself stays signed in.
		expect(await accountPageStatus(idp, browser)).toBe(200);
	});
});
