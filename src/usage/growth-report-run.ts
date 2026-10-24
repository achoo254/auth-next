import type { Db } from "mongodb";
import { CLIENT_USAGE_RETENTION_DAYS } from "./client-usage-model.js";
import type { GrowthReport } from "./growth-report-format.js";
import {
	growthReportTenantIds,
	tenantGrowth,
} from "./growth-report-queries.js";

export const DEFAULT_REPORT_WEEKS = 8;
/**
 * As many weeks as `client_usage` keeps whole: the oldest week starts less
 * than 7 × 57 = 399 days ago, inside the 400-day TTL, so no week shown has
 * lost records to it. (New accounts are not subject to the TTL.)
 */
export const MAX_REPORT_WEEKS = Math.floor(CLIENT_USAGE_RETENTION_DAYS / 7);

export const GROWTH_REPORT_USAGE =
	"usage: growth-report [--weeks N] [--tenant <tenantId>] [--json]";

export interface GrowthReportOptions {
	/** Weeks shown, the current one included (1 to MAX_REPORT_WEEKS). */
	readonly weeks: number;
	/** Only this tenant; every tenant with data when absent. */
	readonly tenantId?: string;
	readonly json: boolean;
}

/** Reads the command line; throws with the usage line on anything unknown. */
export function parseGrowthReportArgs(
	args: readonly string[],
): GrowthReportOptions {
	let weeks = DEFAULT_REPORT_WEEKS;
	let tenantId: string | undefined;
	let json = false;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--json") {
			json = true;
		} else if (arg === "--weeks") {
			const value = Number(args[index + 1]);
			if (!Number.isInteger(value) || value < 1 || value > MAX_REPORT_WEEKS) {
				throw new Error(
					`--weeks takes 1 to ${MAX_REPORT_WEEKS}\n${GROWTH_REPORT_USAGE}`,
				);
			}
			weeks = value;
			index += 1;
		} else if (arg === "--tenant") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error(`--tenant takes a tenant id\n${GROWTH_REPORT_USAGE}`);
			}
			tenantId = value;
			index += 1;
		} else {
			throw new Error(`unknown argument ${arg}\n${GROWTH_REPORT_USAGE}`);
		}
	}
	return { weeks, json, ...(tenantId ? { tenantId } : {}) };
}

/** The report of every tenant (or the one asked for). Reads only. */
export async function buildGrowthReport(
	db: Db,
	options: Pick<GrowthReportOptions, "weeks" | "tenantId">,
	now: Date = new Date(),
): Promise<GrowthReport> {
	const tenantIds = options.tenantId
		? [options.tenantId]
		: await growthReportTenantIds(db);
	const tenants = [];
	for (const id of tenantIds) {
		tenants.push(
			await tenantGrowth({ db, tenant: { id } }, now, options.weeks),
		);
	}
	return {
		timeZone: "Asia/Saigon",
		weekStartsOn: "monday",
		generatedAt: now.toISOString(),
		tenants,
	};
}
