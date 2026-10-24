import type { ClientUsageKind } from "./client-usage-model.js";
import { appCount } from "./usage-apps.js";

/** The rolling window of the report, in days up to the report time. */
export const ROLLING_DAYS = 28;

/** The first app of a new account that has not signed in to any app yet. */
export const NO_APP_YET = "none";

export interface ClientSignIns {
	readonly clientId: string;
	readonly interactive: number;
	readonly sso: number;
	readonly total: number;
}

/** The four numbers of one tenant for one Saigon week (Monday first). */
export interface WeekGrowth {
	/** Saigon date of the week's Monday, e.g. "2026-10-19". */
	readonly week: string;
	/** Accounts created that week (the App Store reviewer's left out). */
	readonly newAccounts: number;
	/** The first app each of those accounts signed in to, by app. */
	readonly firstApps: Readonly<Record<string, number>>;
	/** Accounts that signed in to at least one app that week. */
	readonly activeAccounts: number;
	/** Of those, the ones that signed in to two apps or more. */
	readonly multiAppAccounts: number;
	/** multiAppAccounts / activeAccounts (4 decimals); null without any. */
	readonly multiAppShare: number | null;
	/** Sign-ins per client, the IdP's own clients included, busiest first. */
	readonly signIns: readonly ClientSignIns[];
}

/**
 * The accounts that signed in to at least one app in the last ROLLING_DAYS
 * days up to the report time, and how many of them to two apps or more.
 * Apps keep their own sessions for weeks, so an account using two apps
 * often reaches only one of them in a given week; this window shows the
 * habit the weekly numbers miss.
 */
export interface RollingGrowth {
	readonly days: number;
	/** Start of the window (ISO 8601, UTC). */
	readonly since: string;
	readonly activeAccounts: number;
	readonly multiAppAccounts: number;
	readonly multiAppShare: number | null;
}

export interface TenantGrowth {
	readonly tenantId: string;
	readonly weeks: readonly WeekGrowth[];
	readonly rolling: RollingGrowth;
}

/** Active accounts of a period while the report's queries add to them. */
export interface ActiveTally {
	activeAccounts: number;
	multiAppAccounts: number;
}

/** Counts of one week while the report's queries add to them. */
export interface WeekTally extends ActiveTally {
	newAccounts: number;
	readonly firstApps: Map<string, number>;
	readonly signIns: Map<string, Record<ClientUsageKind, number>>;
}

export function emptyWeekTally(): WeekTally {
	return {
		newAccounts: 0,
		firstApps: new Map(),
		activeAccounts: 0,
		multiAppAccounts: 0,
		signIns: new Map(),
	};
}

/** Counts one account active in the period, with the clients it signed in to. */
export function countActiveAccount(
	tally: ActiveTally,
	clientIds: readonly string[],
): void {
	tally.activeAccounts += 1;
	if (appCount(clientIds) >= 2) tally.multiAppAccounts += 1;
}

/** multiAppAccounts / activeAccounts (4 decimals); null without any. */
export function multiAppShare({
	activeAccounts,
	multiAppAccounts,
}: ActiveTally): number | null {
	return activeAccounts === 0
		? null
		: Math.round((multiAppAccounts / activeAccounts) * 10_000) / 10_000;
}

export function countFirstApp(tally: WeekTally, app: string): void {
	tally.firstApps.set(app, (tally.firstApps.get(app) ?? 0) + 1);
}

export function countSignIns(
	tally: WeekTally,
	clientId: string,
	kind: ClientUsageKind,
	count: number,
): void {
	const client = tally.signIns.get(clientId) ?? { interactive: 0, sso: 0 };
	client[kind] += count;
	tally.signIns.set(clientId, client);
}

/** The finished week: biggest counts first, ties by name. */
export function weekGrowth(week: string, tally: WeekTally): WeekGrowth {
	const { activeAccounts, multiAppAccounts } = tally;
	return {
		week,
		newAccounts: tally.newAccounts,
		firstApps: Object.fromEntries(
			[...tally.firstApps].sort(
				(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
			),
		),
		activeAccounts,
		multiAppAccounts,
		multiAppShare: multiAppShare(tally),
		signIns: [...tally.signIns]
			.map(([clientId, kinds]) => ({
				clientId,
				...kinds,
				total: kinds.interactive + kinds.sso,
			}))
			.sort(
				(a, b) => b.total - a.total || a.clientId.localeCompare(b.clientId),
			),
	};
}
