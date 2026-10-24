import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
import { accountsCollection } from "../accounts/user-model.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { createLogger } from "../logger.js";
import {
	type ClientUsageDocument,
	type ClientUsageKind,
	clientUsageCollection,
} from "../usage/client-usage-model.js";
import { growthReportText } from "../usage/growth-report-format.js";
import {
	buildGrowthReport,
	parseGrowthReportArgs,
} from "../usage/growth-report-run.js";
import { saigonWeekLabel, saigonWeekStart } from "../usage/saigon-weeks.js";
import { openTestDb } from "./helpers/test-accounts.js";

const TENANT = { id: "t-report-a" };
const OTHER = { id: "t-report-b" };
/** Saturday 12:00 in Saigon; the current week started Monday 19 October. */
const NOW = new Date("2026-10-24T05:00:00Z");
/** Monday 00:30 and Sunday 23:30 in Saigon, half an hour either side of a week. */
const MONDAY_0030 = new Date("2026-10-18T17:30:00Z");
const SUNDAY_2330 = new Date("2026-10-18T16:30:00Z");
const MIDWEEK = new Date("2026-10-21T03:00:00Z");
const LAST_WEEK = new Date("2026-10-14T03:00:00Z");

let db: Db;
let close: () => Promise<void>;
const usage: ClientUsageDocument[] = [];

async function account(
	tenant: { id: string },
	name: string,
	createdAt: Date,
	extra: { reviewLogin?: true } = {},
): Promise<string> {
	const repository = new AccountRepository(
		db,
		tenant,
		new AuditOutbox(db, tenant, createLogger("silent")),
	);
	const created = await repository.create({
		username: name,
		emailVerifiedBy: null,
		providers: { github: `gh-${name}` },
	});
	await accountsCollection(db).updateOne(
		{ _id: created._id },
		{ $set: { createdAt, ...extra } },
	);
	return created._id;
}

function used(
	sub: string,
	clientId: string,
	at: Date,
	kind: ClientUsageKind = "sso",
	tenant = TENANT,
): void {
	usage.push({ tenantId: tenant.id, sub, clientId, at, kind });
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	const early = await account(TENANT, "early_one", SUNDAY_2330);
	const late = await account(TENANT, "late_one", MONDAY_0030);
	await account(TENANT, "no_app_yet", MIDWEEK);
	const reviewer = await account(TENANT, "app_reviewer", MIDWEEK, {
		reviewLogin: true,
	});
	const lapsed = await account(
		TENANT,
		"lapsed_one",
		new Date("2026-01-05T00:00:00Z"),
	);
	const old = await account(
		TENANT,
		"old_timer",
		new Date("2026-01-05T00:00:00Z"),
	);
	const foreign = await account(OTHER, "elsewhere", MIDWEEK);

	used(
		early,
		"chat-web",
		new Date(SUNDAY_2330.getTime() + 60_000),
		"interactive",
	);
	used(old, "mcp-dcr-client", LAST_WEEK);
	used(old, "localman-web", LAST_WEEK);
	// /account comes first but is not an app; Scribe is the first app.
	used(
		late,
		"hoandat-account",
		new Date(MONDAY_0030.getTime() + 60_000),
		"interactive",
	);
	used(late, "scribe-web", new Date(MONDAY_0030.getTime() + 120_000));
	used(late, "chat-mobile", MIDWEEK);
	used(early, "localman-web", MIDWEEK);
	used(early, "hoandat-account", MIDWEEK);
	// Web and mobile of one product are one app.
	used(old, "chat-web", MIDWEEK, "interactive");
	used(old, "chat-mobile", MIDWEEK);
	used(foreign, "chat-web", MIDWEEK, "interactive", OTHER);
	// The App Store reviewer is never counted, whatever app it opens.
	used(reviewer, "chat-web", MIDWEEK, "interactive");
	used(reviewer, "localman-web", LAST_WEEK);
	// Two apps 29 days before NOW: outside the last 28 days and both weeks.
	used(lapsed, "chat-web", new Date("2026-09-25T05:00:00Z"));
	used(lapsed, "miu-web", new Date("2026-09-25T06:00:00Z"));
	await clientUsageCollection(db).insertMany(usage);
});

afterAll(async () => {
	await close?.();
});

describe("Saigon weeks", () => {
	it("start on Monday 00:00 at UTC+7", () => {
		expect(saigonWeekStart(MONDAY_0030).toISOString()).toBe(
			"2026-10-18T17:00:00.000Z",
		);
		expect(saigonWeekLabel(saigonWeekStart(MONDAY_0030))).toBe("2026-10-19");
		expect(saigonWeekLabel(saigonWeekStart(SUNDAY_2330))).toBe("2026-10-12");
	});
});

describe("growth report", () => {
	it("gives each tenant's numbers from its own data only, the reviewer left out", async () => {
		const report = await buildGrowthReport(db, { weeks: 2 }, NOW);
		expect(report.tenants.map((tenant) => tenant.tenantId)).toEqual([
			TENANT.id,
			OTHER.id,
		]);
		const [previous, current] = report.tenants[0]?.weeks ?? [];
		expect(previous).toEqual({
			week: "2026-10-12",
			newAccounts: 1,
			firstApps: { chat: 1 },
			activeAccounts: 2,
			multiAppAccounts: 0,
			multiAppShare: 0,
			signIns: [
				{ clientId: "chat-web", interactive: 1, sso: 0, total: 1 },
				{ clientId: "localman-web", interactive: 0, sso: 1, total: 1 },
				{ clientId: "mcp-dcr-client", interactive: 0, sso: 1, total: 1 },
			],
		});
		expect(current).toEqual({
			week: "2026-10-19",
			newAccounts: 2,
			firstApps: { none: 1, scribe: 1 },
			activeAccounts: 3,
			multiAppAccounts: 1,
			multiAppShare: 0.3333,
			signIns: [
				{ clientId: "chat-mobile", interactive: 0, sso: 2, total: 2 },
				{ clientId: "hoandat-account", interactive: 1, sso: 1, total: 2 },
				{ clientId: "chat-web", interactive: 1, sso: 0, total: 1 },
				{ clientId: "localman-web", interactive: 0, sso: 1, total: 1 },
				{ clientId: "scribe-web", interactive: 0, sso: 1, total: 1 },
			],
		});
		// Each account active in the last 28 days used two apps there, though
		// early_one and old_timer reached one app in some week.
		expect(report.tenants[0]?.rolling).toEqual({
			days: 28,
			since: "2026-09-26T05:00:00.000Z",
			activeAccounts: 3,
			multiAppAccounts: 3,
			multiAppShare: 1,
		});
		expect(report.tenants[1]?.weeks.at(-1)).toMatchObject({
			newAccounts: 1,
			firstApps: { chat: 1 },
			activeAccounts: 1,
			signIns: [{ clientId: "chat-web", interactive: 1, sso: 0, total: 1 }],
		});
		expect(report.tenants[1]?.rolling).toMatchObject({
			activeAccounts: 1,
			multiAppAccounts: 0,
		});
	});

	it("reports one tenant on request, empty weeks included, and writes nothing", async () => {
		const before = await clientUsageCollection(db).countDocuments();
		const report = await buildGrowthReport(
			db,
			{ weeks: 4, tenantId: OTHER.id },
			NOW,
		);
		expect(report.tenants).toHaveLength(1);
		expect(report.tenants[0]?.weeks.map((week) => week.week)).toEqual([
			"2026-09-28",
			"2026-10-05",
			"2026-10-12",
			"2026-10-19",
		]);
		expect(report.tenants[0]?.weeks[0]).toMatchObject({
			newAccounts: 0,
			activeAccounts: 0,
			multiAppShare: null,
			signIns: [],
		});
		expect(await clientUsageCollection(db).countDocuments()).toBe(before);
		const text = growthReportText(report);
		expect(text).toContain(`Tenant ${OTHER.id}`);
		expect(text).toContain("Week of 2026-10-19 (current, so far)");
		expect(text).toContain("Signed in to 2+ apps:  0/0 (-)");
		expect(text).toContain("chat-web: 1 (1 interactive, 0 sso)");
		expect(text).toContain(
			"Last 28 days (since 2026-09-26T05:00:00.000Z)\n    Signed in to 2+ apps:  0/1 (0.0%)",
		);
		expect(JSON.parse(JSON.stringify(report))).toMatchObject({
			timeZone: "Asia/Saigon",
			weekStartsOn: "monday",
			generatedAt: NOW.toISOString(),
		});
	});

	it("takes --weeks, --tenant and --json and refuses anything else", () => {
		expect(parseGrowthReportArgs([])).toEqual({ weeks: 8, json: false });
		expect(
			parseGrowthReportArgs(["--weeks", "12", "--tenant", "primary", "--json"]),
		).toEqual({ weeks: 12, tenantId: "primary", json: true });
		// 57 whole weeks fit in the 400-day retention of client_usage.
		expect(parseGrowthReportArgs(["--weeks", "57"]).weeks).toBe(57);
		for (const bad of [
			["--weeks", "0"],
			["--weeks", "58"],
			["--weeks", "two"],
			["--tenant"],
			["--tenant", "--json"],
			["--write"],
		]) {
			expect(() => parseGrowthReportArgs(bad)).toThrow(/usage: growth-report/);
		}
	});
});
