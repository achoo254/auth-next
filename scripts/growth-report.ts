/**
 * Weekly growth numbers per tenant (ADR 0011), weeks from Monday 00:00
 * Asia/Saigon: new accounts, the first app of each new account, the share
 * of active accounts that signed in to two apps or more, and sign-ins per
 * client; plus that share over the last 28 days. The App Store reviewer's
 * accounts are left out. Reads only: it writes nothing and creates no index.
 *
 *   node --env-file=.env dist/growth-report.mjs                  last 8 weeks, every tenant
 *   node --env-file=.env dist/growth-report.mjs --weeks 12 --tenant <tenantId> --json
 */
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { growthReportText } from "../src/usage/growth-report-format.js";
import {
	buildGrowthReport,
	parseGrowthReportArgs,
} from "../src/usage/growth-report-run.js";

async function main(): Promise<void> {
	const options = parseGrowthReportArgs(process.argv.slice(2));
	const env = parseEnv(process.env);
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const report = await buildGrowthReport(connection.db, options);
		process.stdout.write(
			options.json
				? `${JSON.stringify(report, null, 2)}\n`
				: growthReportText(report),
		);
	} finally {
		await connection.client.close();
	}
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`growth-report failed: ${message}\n`);
		process.exit(1);
	},
);
