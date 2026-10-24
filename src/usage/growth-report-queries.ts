import type { Collection, Db, Filter } from "mongodb";
import { accountsCollection } from "../accounts/user-model.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import {
	type ClientUsageDocument,
	type ClientUsageKind,
	clientUsageCollection,
} from "./client-usage-model.js";
import {
	SAIGON_UTC_OFFSET,
	lastSaigonWeeks,
	saigonWeekLabel,
	saigonWeekStart,
} from "./saigon-weeks.js";
import { IDP_OWN_CLIENT_IDS, appOfClient } from "./usage-apps.js";
import {
	type ActiveTally,
	NO_APP_YET,
	ROLLING_DAYS,
	type RollingGrowth,
	type TenantGrowth,
	type WeekTally,
	countActiveAccount,
	countFirstApp,
	countSignIns,
	emptyWeekTally,
	multiAppShare,
	weekGrowth,
} from "./week-growth.js";

const IDP_OWN = [...IDP_OWN_CLIENT_IDS];
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Saigon week of a usage document, as computed by MongoDB. */
const USAGE_WEEK = {
	$dateTrunc: {
		date: "$at",
		unit: "week",
		startOfWeek: "monday",
		timezone: SAIGON_UTC_OFFSET,
	},
};

/** Every tenant with accounts or usage: the report's one all-tenants read. */
export async function growthReportTenantIds(db: Db): Promise<string[]> {
	const [accounts, usage] = await Promise.all([
		accountsCollection(db).distinct("tenantId"),
		clientUsageCollection(db).distinct("tenantId"),
	]);
	return [...new Set([...accounts, ...usage])].sort();
}

/**
 * The distinct app clients of each account that used one in `match`,
 * grouped by `by` (the account, or its week and the account).
 */
function activeAccountClients<Key>(
	usage: Collection<ClientUsageDocument>,
	match: Filter<ClientUsageDocument>,
	by: Record<string, unknown> | string,
): Promise<{ _id: Key; clients: string[] }[]> {
	return usage
		.aggregate<{ _id: Key; clients: string[] }>([
			{ $match: { ...match, clientId: { $nin: IDP_OWN } } },
			{ $group: { _id: by, clients: { $addToSet: "$clientId" } } },
		])
		.toArray();
}

/**
 * The last `weeks` Saigon weeks of one tenant, oldest first, the current
 * (partial) week last, and the last ROLLING_DAYS days. The App Store
 * reviewer's accounts (`reviewLogin`, ADR 0010) are left out of every
 * number. Reads only.
 */
export async function tenantGrowth(
	{ db, tenant }: TenantDb,
	now: Date,
	weeks: number,
): Promise<TenantGrowth> {
	const scope = inTenant(tenant);
	const starts = lastSaigonWeeks(now, weeks);
	const from = starts[0] ?? saigonWeekStart(now);
	const tallies = new Map<string, WeekTally>(
		starts.map((start) => [saigonWeekLabel(start), emptyWeekTally()]),
	);
	const usage = clientUsageCollection(db);
	const reviewers = await accountsCollection(db).distinct("_id", {
		...scope,
		reviewLogin: { $exists: true },
	});
	const people: Filter<ClientUsageDocument> = {
		...scope,
		sub: { $nin: reviewers },
	};

	const accounts = await accountsCollection(db)
		.find(
			{ ...scope, createdAt: { $gte: from }, reviewLogin: { $exists: false } },
			{ projection: { _id: 1, createdAt: 1 } },
		)
		.toArray();
	const firstClients = new Map(
		(
			await usage
				.aggregate<{ _id: string; clientId: string }>([
					{
						$match: {
							...scope,
							sub: { $in: accounts.map((account) => account._id) },
							clientId: { $nin: IDP_OWN },
						},
					},
					{ $sort: { sub: 1, at: 1 } },
					{ $group: { _id: "$sub", clientId: { $first: "$clientId" } } },
				])
				.toArray()
		).map((first) => [first._id, first.clientId]),
	);
	for (const account of accounts) {
		const tally = tallies.get(
			saigonWeekLabel(saigonWeekStart(account.createdAt)),
		);
		if (!tally) continue;
		tally.newAccounts += 1;
		const firstClient = firstClients.get(account._id);
		const app =
			firstClient === undefined ? undefined : appOfClient(firstClient);
		countFirstApp(tally, app ?? NO_APP_YET);
	}

	const signIns = await usage
		.aggregate<{
			_id: { week: Date; clientId: string; kind: ClientUsageKind };
			count: number;
		}>([
			{ $match: { ...people, at: { $gte: from } } },
			{
				$group: {
					_id: { week: USAGE_WEEK, clientId: "$clientId", kind: "$kind" },
					count: { $sum: 1 },
				},
			},
		])
		.toArray();
	for (const { _id, count } of signIns) {
		const tally = tallies.get(saigonWeekLabel(_id.week));
		if (!tally) continue;
		countSignIns(tally, _id.clientId, _id.kind, count);
	}

	const weekly = await activeAccountClients<{ week: Date }>(
		usage,
		{ ...people, at: { $gte: from } },
		{ week: USAGE_WEEK, sub: "$sub" },
	);
	for (const { _id, clients } of weekly) {
		const tally = tallies.get(saigonWeekLabel(_id.week));
		if (tally) countActiveAccount(tally, clients);
	}

	return {
		tenantId: tenant.id,
		weeks: [...tallies].map(([week, tally]) => weekGrowth(week, tally)),
		rolling: await rollingGrowth(usage, people, now),
	};
}

/** Accounts active in the last ROLLING_DAYS days up to `now`. */
async function rollingGrowth(
	usage: Collection<ClientUsageDocument>,
	people: Filter<ClientUsageDocument>,
	now: Date,
): Promise<RollingGrowth> {
	const since = new Date(now.getTime() - ROLLING_DAYS * DAY_MS);
	const tally: ActiveTally = { activeAccounts: 0, multiAppAccounts: 0 };
	const accounts = await activeAccountClients<string>(
		usage,
		{ ...people, at: { $gte: since, $lte: now } },
		"$sub",
	);
	for (const { clients } of accounts) countActiveAccount(tally, clients);
	return {
		days: ROLLING_DAYS,
		since: since.toISOString(),
		...tally,
		multiAppShare: multiAppShare(tally),
	};
}
