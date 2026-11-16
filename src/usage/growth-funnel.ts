import type { Document } from "mongodb";
import { accountsCollection } from "../accounts/user-model.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { CLIENT_USAGE_COLLECTION } from "./client-usage-model.js";
import { SAIGON_UTC_OFFSET } from "./saigon-weeks.js";
import { IDP_OWN_CLIENT_IDS } from "./usage-apps.js";

/**
 * Where new accounts come from and how many come back, for Tiểu Đệ's
 * report (ADR 0014). Counts only; the App Store reviewer's accounts are
 * left out like everywhere in the growth numbers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 7 * 60 * 60 * 1000;

/** An account is activated by using an app on Saigon day 1 to 7 after the day it was made. */
export const ACTIVATION_LAST_DAY = 7;
/** The cohort: accounts made 37 to 7 days ago, so each had its whole week. */
export const ACTIVATION_COHORT_DAYS = 30;

export interface SignupSourceCount {
	readonly client: string | null;
	readonly utmSource: string | null;
	readonly utmCampaign: string | null;
	readonly count: number;
}

export interface SignupSources {
	/** Accounts made since 00:00 Saigon six days ago (today and the six days before). */
	readonly last7d: readonly SignupSourceCount[];
	readonly last30d: readonly SignupSourceCount[];
}

export interface Activation {
	readonly cohortSignedUp: number;
	readonly cohortActivated: number;
	readonly activatedTotal: number;
}

/** 00:00 in Saigon of the day `days - 1` days before the Saigon day of `now`. */
export function saigonDaysStart(now: Date, days: number): Date {
	const local = new Date(now.getTime() + OFFSET_MS);
	const midnight = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate() - (days - 1),
	);
	return new Date(midnight - OFFSET_MS);
}

const people = (tenantDb: TenantDb) => ({
	...inTenant(tenantDb.tenant),
	reviewLogin: { $exists: false },
});

async function sourcesSince(
	tenantDb: TenantDb,
	since: Date,
): Promise<SignupSourceCount[]> {
	const rows = await accountsCollection(tenantDb.db)
		.aggregate<{
			_id: { client: unknown; utmSource: unknown; utmCampaign: unknown };
			count: number;
		}>([
			{ $match: { ...people(tenantDb), createdAt: { $gte: since } } },
			{
				$group: {
					_id: {
						client: { $ifNull: ["$signupSource.client", null] },
						utmSource: { $ifNull: ["$signupSource.utmSource", null] },
						utmCampaign: { $ifNull: ["$signupSource.utmCampaign", null] },
					},
					count: { $sum: 1 },
				},
			},
		])
		.toArray();
	const text = (value: unknown): string | null =>
		typeof value === "string" ? value : null;
	return rows
		.map((row) => ({
			client: text(row._id.client),
			utmSource: text(row._id.utmSource),
			utmCampaign: text(row._id.utmCampaign),
			count: row.count,
		}))
		.sort(
			(a, b) =>
				b.count - a.count ||
				`${a.client}/${a.utmSource}/${a.utmCampaign}`.localeCompare(
					`${b.client}/${b.utmSource}/${b.utmCampaign}`,
				),
		);
}

export async function signupSources(
	tenantDb: TenantDb,
	now: Date,
): Promise<SignupSources> {
	const [last7d, last30d] = await Promise.all([
		sourcesSince(tenantDb, saigonDaysStart(now, 7)),
		sourcesSince(tenantDb, saigonDaysStart(now, 30)),
	]);
	return { last7d, last30d };
}

/** Saigon days from the account's creation to `$at` (0 = the same Saigon day). */
const SAIGON_DAYS_AFTER_SIGNUP: Document = {
	$dateDiff: {
		startDate: "$$created",
		endDate: "$at",
		unit: "day",
		timezone: SAIGON_UTC_OFFSET,
	},
};

/**
 * Activated: the account signed in to an app (not the IdP's own pages,
 * same rule as `regular14d`) on a Saigon day strictly after the day it was
 * made and at most ACTIVATION_LAST_DAY days after it. Counted for the
 * cohort made between 37 and 7 days ago and for every account ever.
 */
export async function activation(
	tenantDb: TenantDb,
	now: Date,
): Promise<Activation> {
	const cohortTo = new Date(now.getTime() - ACTIVATION_LAST_DAY * DAY_MS);
	const cohortFrom = new Date(
		cohortTo.getTime() - ACTIVATION_COHORT_DAYS * DAY_MS,
	);
	const [row] = await accountsCollection(tenantDb.db)
		.aggregate<Activation>([
			{ $match: people(tenantDb) },
			{
				$lookup: {
					from: CLIENT_USAGE_COLLECTION,
					localField: "_id",
					foreignField: "sub",
					let: { created: "$createdAt" },
					pipeline: [
						{
							$match: {
								...inTenant(tenantDb.tenant),
								clientId: { $nin: [...IDP_OWN_CLIENT_IDS] },
							},
						},
						{
							$match: {
								$expr: {
									$and: [
										{ $gte: [SAIGON_DAYS_AFTER_SIGNUP, 1] },
										{ $lte: [SAIGON_DAYS_AFTER_SIGNUP, ACTIVATION_LAST_DAY] },
									],
								},
							},
						},
						{ $limit: 1 },
						{ $project: { _id: 1 } },
					],
					as: "activations",
				},
			},
			{
				$project: {
					cohort: {
						$and: [
							{ $gte: ["$createdAt", cohortFrom] },
							{ $lte: ["$createdAt", cohortTo] },
						],
					},
					activated: { $gt: [{ $size: "$activations" }, 0] },
				},
			},
			{
				$group: {
					_id: null,
					cohortSignedUp: { $sum: { $cond: ["$cohort", 1, 0] } },
					cohortActivated: {
						$sum: { $cond: [{ $and: ["$cohort", "$activated"] }, 1, 0] },
					},
					activatedTotal: { $sum: { $cond: ["$activated", 1, 0] } },
				},
			},
			{ $project: { _id: 0 } },
		])
		.toArray();
	return row ?? { cohortSignedUp: 0, cohortActivated: 0, activatedTotal: 0 };
}
