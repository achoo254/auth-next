import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { afterPasswordChange } from "../account-portal/after-password-change.js";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
} from "./helpers/test-accounts.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

/** The events recorded for `sub`, oldest first, as type plus data. */
async function eventsOf(sub: string) {
	const events = await auditOutboxCollection(idp.db)
		.find({ sub })
		.sort({ occurredAt: 1 })
		.toArray();
	return events.map(({ type, data, context }) => ({ type, data, context }));
}

describe("credential events land in the outbox", () => {
	it("records sign-ins that succeed and fail, per account", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const wrong = await postLogin(
			idp,
			await openLoginPage(idp),
			account.username,
			"not the password",
		);
		expect(wrong.status).toBe(401);
		await signedInBrowser(idp, account);

		const events = await eventsOf(account._id);
		expect(events).toMatchObject([
			{
				type: "login.failed",
				data: { method: "password", reason: "invalid" },
				context: { ip: expect.any(String) },
			},
			{ type: "login.succeeded", data: { methods: ["pwd"] } },
		]);
		// An unknown identifier has no account to attach an event to.
		const before = await auditOutboxCollection(idp.db).countDocuments();
		await postLogin(idp, await openLoginPage(idp), "nobody_here", "x");
		expect(await auditOutboxCollection(idp.db).countDocuments()).toBe(before);
	});

	it("records link changes, new recovery codes and a reclaimed email", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.setTelegram(account._id, { chatId: "9001" });
		await accounts.links.unsetTelegram(account._id);
		await accounts.links.linkProvider(account, {
			provider: "github",
			providerId: "gh-1",
		});
		await accounts.links.unlinkProvider(account._id, "github");
		await accounts.replaceRecoveryCodes(account._id, ["hash"]);
		await accounts.links.reclaimEmail(account.email);

		expect((await eventsOf(account._id)).map((event) => event.data)).toEqual([
			{ method: "telegram" },
			{ method: "telegram" },
			{ method: "github" },
			{ method: "github" },
			{},
			{},
		]);
		expect((await eventsOf(account._id)).map((event) => event.type)).toEqual([
			"method.linked",
			"method.unlinked",
			"method.linked",
			"method.unlinked",
			"recovery_codes.regenerated",
			"email.reclaimed",
		]);
	});

	it("records a reset and what it revoked, and nothing secret", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		await cliLogin(idp, browser);
		await afterPasswordChange(idp.services, account, "reset-link", {
			grants: true,
		});

		const events = await eventsOf(account._id);
		// Recorded after what it revoked: the audit trail comes last.
		expect(events.slice(-3)).toMatchObject([
			{
				type: "session.revoked",
				data: { count: 1, cause: "password-reset" },
			},
			// The Localman grant went with its session; the Tunelo device's
			// grant is revoked on its own.
			{
				type: "grant.revoked",
				data: { count: 1, cause: "password-reset" },
			},
			{ type: "password.reset", data: { via: "reset-link" } },
		]);
		const stored = JSON.stringify(
			await auditOutboxCollection(idp.db).find({}).toArray(),
		);
		expect(stored).not.toContain(TEST_PASSWORD);
		// No field that could carry a credential, whatever its value.
		expect(stored).not.toMatch(/"\w*(token|secret|password|hash|code)\w*":/i);
	});
});

/** Makes every audit write fail, as an unreachable or broken outbox would. */
async function breakAuditWrites(broken: boolean): Promise<void> {
	await idp.db.command({
		collMod: "audit_outbox",
		validator: broken ? { neverPresent: { $exists: true } } : {},
		validationLevel: broken ? "strict" : "off",
	});
}

describe("audit never stands in the way of a security step", () => {
	it("a reset still revokes everything and starts the review when audit writes fail", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const cli = await cliLogin(idp, browser);
		await breakAuditWrites(true);
		try {
			await afterPasswordChange(idp.services, account, "reset-link", {
				grants: true,
			});
		} finally {
			await breakAuditWrites(false);
		}
		expect(await accountPageStatus(idp, browser)).toBe(303);
		await expect(
			client.refreshTokenGrant(cli.config, cli.refreshToken),
		).rejects.toMatchObject({ error: "invalid_grant" });
		const stored = await repositoryOf(idp).findActiveById(account._id);
		expect(stored?.securityReviewPendingSince).toBeInstanceOf(Date);
		expect(
			(await eventsOf(account._id)).map((event) => event.type),
		).not.toContain("password.reset");
	});
});
