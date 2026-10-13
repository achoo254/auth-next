/**
 * Tags documents written before tenants existed with the primary tenant's
 * `tenantId`, after the tenant-aware release is deployed:
 *
 *   node dist/backfill-tenant-id.mjs --dry-run   (counts only, writes nothing)
 *   node dist/backfill-tenant-id.mjs
 *
 * Idempotent: a second run finds nothing to tag. Exit code 1 when untagged
 * documents remain after a real run (a write raced it: run it again).
 */
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { PRIMARY_TENANT_ID } from "../src/tenants/env-tenant.js";
import { backfillTenantId } from "../src/tenants/tenant-collections.js";

async function main(): Promise<number> {
	const dryRun = process.argv.includes("--dry-run");
	const env = parseEnv(process.env);
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const counts = await backfillTenantId(connection.db, PRIMARY_TENANT_ID, {
			dryRun,
		});
		for (const count of counts) {
			process.stdout.write(
				`${count.collection}: ${count.untagged} untagged, ${count.tagged} tagged\n`,
			);
		}
		if (dryRun) {
			process.stdout.write("Dry run: nothing written\n");
			return 0;
		}
		const after = await backfillTenantId(connection.db, PRIMARY_TENANT_ID, {
			dryRun: true,
		});
		const left = after.reduce((sum, count) => sum + count.untagged, 0);
		process.stdout.write(`Untagged documents left: ${left}\n`);
		return left === 0 ? 0 : 1;
	} finally {
		await connection.client.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`backfill-tenant-id failed: ${message}\n`);
		process.exit(1);
	},
);
