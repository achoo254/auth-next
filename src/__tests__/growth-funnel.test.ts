import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
import {
	type AccountDocument,
	accountsCollection,
} from "../accounts/user-model.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { createLogger } from "../logger.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { clientUsageCollection } from "../usage/client-usage-model.js";
import {
	activation,
	saigonDaysStart,
	signupSources,
} from "../usage/growth-funnel.js";
import { openTestDb } from "./helpers/test-accounts.js";

/** Monday 16 November 2026, 10:00 in Saigon. */
const NOW = new Date("2026-11-16T03:00:00Z");
const at = (iso: string) => new Date(iso);
const OTHER = { id: "t-funnel-other" };

let db: Db;
let close: () => Promise<void>;
let seq = 0;

async function account(
	tenant: { id: string },
	createdAt: Date,
	extra: Partial<Pick<AccountDocument, "signupSource" | "reviewLogin">> = {},
): Promise<string> {
	seq += 1;
	const created = await new AccountRepository(
		db,
		tenant,
		new AuditOutbox(db, tenant, createLogger("silent")),
	).create({
		username: `funnel_${seq}`,
		emailVerifiedBy: null,
		providers: { github: `gh-funnel-${seq}` },
	});
	await accountsCollection(db).updateOne(
		{ _id: created._id },
		{ $set: { createdAt, ...extra } },
	);
	return created._id;
}

async function use(
	tenant: { id: string },
	sub: string,
	clientId: string,
	when: Date,
): Promise<void> {
	await clientUsageCollection(db).insertOne({
		tenantId: tenant.id,
		sub,
		clientId,
		at: when,
		kind: "sso",
	});
}

const row = (
	client: string | null,
	utmSource: string | null,
	utmCampaign: string | null,
	count: number,
) => ({ client, utmSource, utmCampaign, count });

beforeAll(async () => {
	({ db, close } = await openTestDb());
});

afterAll(async () => {
	await close();
});

describe("Saigon day windows", () => {
	it("start at 00:00 Saigon of the first day", () => {
		expect(saigonDaysStart(NOW, 1).toISOString()).toBe(
			"2026-11-15T17:00:00.000Z",
		);
		expect(saigonDaysStart(NOW, 7).toISOString()).toBe(
			"2026-11-09T17:00:00.000Z",
		);
		// 23:30 UTC is already the next day in Saigon.
		expect(saigonDaysStart(at("2026-11-15T23:30:00Z"), 1).toISOString()).toBe(
			"2026-11-15T17:00:00.000Z",
		);
	});
});

describe("signup sources", () => {
	const T = { id: "t-funnel-sources" };

	it("groups new accounts by client and tags over Saigon days", async () => {
		const fb = {
			client: "tuvi-web",
			utmSource: "fb",
			utmMedium: "paid",
			utmCampaign: "short",
		};
		// 00:30 Saigon on 10 November: the first day of the last 7.
		await account(T, at("2026-11-09T17:30:00Z"), { signupSource: fb });
		// 23:30 Saigon on 9 November: a day too early for the last 7.
		await account(T, at("2026-11-09T16:30:00Z"), { signupSource: fb });
		await account(T, at("2026-11-15T03:00:00Z"), {
			signupSource: { client: "tuvi-web" },
		});
		// Made before the source was recorded.
		await account(T, at("2026-11-14T03:00:00Z"));
		// Older than 30 days, the reviewer and another tenant never count.
		await account(T, at("2026-10-10T03:00:00Z"), { signupSource: fb });
		await account(T, at("2026-11-15T03:00:00Z"), {
			signupSource: fb,
			reviewLogin: true,
		});
		await account(OTHER, at("2026-11-15T03:00:00Z"), { signupSource: fb });

		expect(await signupSources({ db, tenant: T }, NOW)).toEqual({
			last7d: [
				row(null, null, null, 1),
				row("tuvi-web", "fb", "short", 1),
				row("tuvi-web", null, null, 1),
			],
			last30d: [
				row("tuvi-web", "fb", "short", 2),
				row(null, null, null, 1),
				row("tuvi-web", null, null, 1),
			],
		});
	});
});

describe("activation", () => {
	const T = { id: "t-funnel-activation" };
	const app = "tuvi-web";

	it("counts app use on Saigon day 1 to 7 after the sign-up day", async () => {
		// 20:00 Saigon on 20 October, inside the cohort (10 Oct to 9 Nov).
		const made = at("2026-10-20T13:00:00Z");
		// Later the same Saigon day: not activated.
		const sameDay = await account(T, made);
		await use(T, sameDay, app, at("2026-10-20T16:59:00Z"));
		// 00:01 Saigon the next day: day 1, activated.
		const nextDay = await account(T, made);
		await use(T, nextDay, app, at("2026-10-20T17:01:00Z"));
		// 23:00 Saigon on 27 October: day 7, activated.
		const lastDay = await account(T, made);
		await use(T, lastDay, app, at("2026-10-27T16:00:00Z"));
		// 00:30 Saigon on 28 October: day 8, too late.
		const tooLate = await account(T, made);
		await use(T, tooLate, app, at("2026-10-27T17:30:00Z"));
		// Only the IdP's own pages: not an app.
		const ownPages = await account(T, made);
		await use(
			T,
			ownPages,
			STATIC_CLIENT_IDS.accountPortal,
			at("2026-10-22T03:00:00Z"),
		);
		// The reviewer never counts.
		const reviewer = await account(T, made, { reviewLogin: true });
		await use(T, reviewer, app, at("2026-10-22T03:00:00Z"));
		// Use recorded under another tenant does not activate.
		const elsewhere = await account(T, made);
		await use(OTHER, elsewhere, app, at("2026-10-22T03:00:00Z"));
		// Made 3 days ago: outside the cohort, activated overall.
		const recent = await account(T, at("2026-11-13T03:00:00Z"));
		await use(T, recent, app, at("2026-11-14T03:00:00Z"));
		// Older than the cohort, activated overall.
		const old = await account(T, at("2026-09-01T03:00:00Z"));
		await use(T, old, app, at("2026-09-03T03:00:00Z"));

		expect(await activation({ db, tenant: T }, NOW)).toEqual({
			cohortSignedUp: 6,
			cohortActivated: 2,
			activatedTotal: 4,
		});
	});

	it("is all zero without accounts", async () => {
		expect(
			await activation({ db, tenant: { id: "t-funnel-empty" } }, NOW),
		).toEqual({ cohortSignedUp: 0, cohortActivated: 0, activatedTotal: 0 });
	});
});
