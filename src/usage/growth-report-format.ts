import type { TenantGrowth, WeekGrowth } from "./week-growth.js";

/** What `growth-report --json` prints. */
export interface GrowthReport {
	readonly timeZone: "Asia/Saigon";
	readonly weekStartsOn: "monday";
	readonly generatedAt: string;
	readonly tenants: readonly TenantGrowth[];
}

function percent(share: number | null): string {
	return share === null ? "-" : `${(share * 100).toFixed(1)}%`;
}

function weekLines(week: WeekGrowth, current: boolean): string[] {
	const firstApps = Object.entries(week.firstApps)
		.map(([app, count]) => `${app} ${count}`)
		.join(", ");
	return [
		`  Week of ${week.week}${current ? " (current, so far)" : ""}`,
		`    New accounts:          ${week.newAccounts}`,
		`    First app:             ${firstApps || "-"}`,
		`    Signed in to 2+ apps:  ${week.multiAppAccounts}/${week.activeAccounts} (${percent(week.multiAppShare)})`,
		`    Sign-ins by client:${week.signIns.length === 0 ? "    -" : ""}`,
		...week.signIns.map(
			(client) =>
				`      ${client.clientId}: ${client.total} (${client.interactive} interactive, ${client.sso} sso)`,
		),
	];
}

/** The report as plain text, one block per tenant, oldest week first. */
export function growthReportText(report: GrowthReport): string {
	const lines = [
		`Growth report: weeks start Monday 00:00 ${report.timeZone}; generated ${report.generatedAt}`,
		"Apps: web, mobile and dev clients of one product count once; /account and the account app are left out.",
	];
	for (const tenant of report.tenants) {
		lines.push("", `Tenant ${tenant.tenantId}`);
		tenant.weeks.forEach((week, index) => {
			lines.push(...weekLines(week, index === tenant.weeks.length - 1));
		});
	}
	return `${lines.join("\n")}\n`;
}
