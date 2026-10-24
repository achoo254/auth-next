/**
 * Weeks of the growth report: Monday 00:00 to Monday 00:00 in Asia/Saigon,
 * which is UTC+7 all year (no daylight saving), so a fixed offset is exact
 * both here and in MongoDB's `$dateTrunc`.
 */
export const SAIGON_UTC_OFFSET = "+07:00";

const OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** The instant the Saigon week holding `date` starts (its Monday, 00:00). */
export function saigonWeekStart(date: Date): Date {
	const local = new Date(date.getTime() + OFFSET_MS);
	const daysSinceMonday = (local.getUTCDay() + 6) % 7;
	const localMidnight = Date.UTC(
		local.getUTCFullYear(),
		local.getUTCMonth(),
		local.getUTCDate() - daysSinceMonday,
	);
	return new Date(localMidnight - OFFSET_MS);
}

/** A week by the Saigon date of its Monday, e.g. "2026-10-19". */
export function saigonWeekLabel(weekStart: Date): string {
	return new Date(weekStart.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** The starts of the last `count` weeks, oldest first, the current one last. */
export function lastSaigonWeeks(now: Date, count: number): Date[] {
	const current = saigonWeekStart(now).getTime();
	return Array.from(
		{ length: count },
		(_, index) => new Date(current - (count - 1 - index) * WEEK_MS),
	);
}
