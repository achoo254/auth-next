import type { Db } from "mongodb";
import { accountsCollection } from "../accounts/user-model.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import {
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
	NO_APP_YET,
	type TenantGrowth,
	type WeekTally,
	countFirstApp,
	countSignIns,
	emptyWeekTally,
	weekGrowth,
} from "./week-growth.js";

const IDP_OWN = [...IDP_OWN_CLIENT_IDS];

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
 * The last `weeks` Saigon weeks of one tenant, oldest first, the current
 * (partial) week last. Reads only.
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
			{ $match: { ...scope, at: { $gte: from } } },
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

	const active = await usage
		.aggregate<{ _id: { week: Date; sub: string }; clients: string[] }>([
			{ $match: { ...scope, at: { $gte: from }, clientId: { $nin: IDP_OWN } } },
			{
				$group: {
					_id: { week: USAGE_WEEK, sub: "$sub" },
					clients: { $addToSet: "$clientId" },
				},
			},
		])
		.toArray();
	for (const { _id, clients } of active) {
		const tally = tallies.get(saigonWeekLabel(_id.week));
		if (!tally) continue;
		tally.activeAccounts += 1;
		const apps = new Set(clients.map(appOfClient));
		if (apps.size >= 2) tally.multiAppAccounts += 1;
	}

	return {
		tenantId: tenant.id,
		weeks: [...tallies].map(([week, tally]) => weekGrowth(week, tally)),
	};
}
