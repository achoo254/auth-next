import type { ClientUsageKind } from "./client-usage-model.js";

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

export interface TenantGrowth {
	readonly tenantId: string;
	readonly weeks: readonly WeekGrowth[];
}

/** Counts of one week while the report's queries add to them. */
export interface WeekTally {
	newAccounts: number;
	readonly firstApps: Map<string, number>;
	activeAccounts: number;
	multiAppAccounts: number;
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
		multiAppShare:
			activeAccounts === 0
				? null
				: Math.round((multiAppAccounts / activeAccounts) * 10_000) / 10_000,
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
