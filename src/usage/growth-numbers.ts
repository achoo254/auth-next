import { accountsCollection } from "../accounts/user-model.js";
import { type TenantDb, inTenant } from "../tenants/tenant-data.js";
import { clientUsageCollection } from "./client-usage-model.js";
import { SAIGON_UTC_OFFSET } from "./saigon-weeks.js";
import { IDP_OWN_CLIENT_IDS } from "./usage-apps.js";

/**
 * The ecosystem's daily progress numbers for Tiểu Đệ's report (accounts and
 * regular users toward the end-2026 targets). Counts only, nothing about a
 * person; the App Store reviewer's accounts are left out like in the growth
 * report. A regular user signed in to an app (sign-in or SSO pass-through,
 * ADR 0011) on at least REGULAR_MIN_DAYS different Saigon days of the last
 * REGULAR_WINDOW_DAYS: an app session that never comes back to the IdP is
 * not seen, so this is a floor.
 */
export const REGULAR_WINDOW_DAYS = 14;
export const REGULAR_MIN_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GrowthNumbers {
	readonly accounts: number;
	readonly newLast24h: number;
	readonly newLast7d: number;
	/** Accounts that signed in to an app in the last REGULAR_WINDOW_DAYS days. */
	readonly active14d: number;
	readonly regular14d: number;
}

export async function growthNumbers(
	{ db, tenant }: TenantDb,
	now: Date,
): Promise<GrowthNumbers> {
	const scope = inTenant(tenant);
	const people = { ...scope, reviewLogin: { $exists: false } };
	const accounts = accountsCollection(db);
	const reviewers = await accounts.distinct("_id", {
		...scope,
		reviewLogin: { $exists: true },
	});
	const [total, newLast24h, newLast7d, days] = await Promise.all([
		accounts.countDocuments(people),
		accounts.countDocuments({
			...people,
			createdAt: { $gte: new Date(now.getTime() - DAY_MS) },
		}),
		accounts.countDocuments({
			...people,
			createdAt: { $gte: new Date(now.getTime() - 7 * DAY_MS) },
		}),
		clientUsageCollection(db)
			.aggregate<{ _id: string; days: number }>([
				{
					$match: {
						...scope,
						sub: { $nin: reviewers },
						clientId: { $nin: [...IDP_OWN_CLIENT_IDS] },
						at: {
							$gte: new Date(now.getTime() - REGULAR_WINDOW_DAYS * DAY_MS),
						},
					},
				},
				{
					$group: {
						_id: "$sub",
						days: {
							$addToSet: {
								$dateToString: {
									date: "$at",
									format: "%Y-%m-%d",
									timezone: SAIGON_UTC_OFFSET,
								},
							},
						},
					},
				},
				{ $project: { days: { $size: "$days" } } },
			])
			.toArray(),
	]);
	return {
		accounts: total,
		newLast24h,
		newLast7d,
		active14d: days.length,
		regular14d: days.filter((d) => d.days >= REGULAR_MIN_DAYS).length,
	};
}
