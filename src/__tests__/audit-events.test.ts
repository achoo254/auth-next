import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
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
	it("records a Google sign-in, with where it came from", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		await signedInBrowser(idp, account);
		expect(await eventsOf(account._id)).toMatchObject([
			{
				type: "login.succeeded",
				data: { methods: ["fed", "google"] },
				context: { ip: expect.any(String) },
			},
		]);
	});

	it("records link changes and a reclaimed email, and nothing secret", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts);
		await accounts.links.setTelegram(account._id, { chatId: "9001" });
		await accounts.links.unsetTelegram(account._id);
		await accounts.links.linkProvider(account, {
			provider: "github",
			providerId: "gh-1",
		});
		await accounts.links.unlinkProvider(account._id, "github");
		await accounts.links.reclaimEmail(account.email);

		expect(await eventsOf(account._id)).toMatchObject([
			{ type: "method.linked", data: { method: "telegram" } },
			{ type: "method.unlinked", data: { method: "telegram" } },
			{ type: "method.linked", data: { method: "github" } },
			{ type: "method.unlinked", data: { method: "github" } },
			{ type: "email.reclaimed", data: {} },
		]);
		const stored = JSON.stringify(
			await auditOutboxCollection(idp.db).find({}).toArray(),
		);
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
	it("an unlink still happens when audit writes fail", async () => {
		const accounts = repositoryOf(idp);
		const account = await createTestAccount(accounts, {
			providers: { google: `g-audit-${Date.now()}`, github: "gh-audit" },
		});
		await breakAuditWrites(true);
		let write: Awaited<ReturnType<typeof accounts.links.unlinkProvider>>;
		try {
			write = await accounts.links.unlinkProvider(account._id, "github");
		} finally {
			await breakAuditWrites(false);
		}
		expect(write).toMatchObject({ applied: true });
		expect(
			(await accounts.findActiveById(account._id))?.providers.github,
		).toBeUndefined();
		expect(
			(await eventsOf(account._id)).map((event) => event.type),
		).not.toContain("method.unlinked");
	});
});
