/**
 * Deletes what this server still keeps of a tenant that moved to its own
 * servers (ADR 0007 §7): its documents and sealed secrets, once it has been
 * self-hosted for the retention window (the backups' 14 days, the way
 * back). The registry entry stays, so the domain cannot be claimed here.
 *
 *   node --env-file=.env dist/purge-tenant.mjs <domain>            counts only
 *   node --env-file=.env dist/purge-tenant.mjs <domain> --confirm  deletes
 *
 * `--any-status` purges a tenant whatever its status or age (the owner
 * shutting tenants down); it still prints the tenant and its counts.
 *
 * Back up the database first (infra/backup-auth-db.sh).
 */
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { purgeRefusal } from "../src/tenants/purge-eligibility.js";
import {
	countTenantData,
	purgeTenantData,
} from "../src/tenants/tenant-collections.js";
import { TenantRegistry } from "../src/tenants/tenant-registry.js";

async function main(): Promise<number> {
	const [domain] = process.argv.slice(2);
	if (!domain || domain.startsWith("--")) {
		throw new Error("usage: purge-tenant <domain> [--any-status] [--confirm]");
	}
	const confirm = process.argv.includes("--confirm");
	const anyStatus = process.argv.includes("--any-status");
	const env = parseEnv(process.env);
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const tenant = await new TenantRegistry(connection.db).findByDomain(domain);
		const refusal = purgeRefusal(domain, tenant, Date.now(), anyStatus);
		if (refusal !== undefined || !tenant) throw new Error(refusal);
		process.stdout.write(`tenant: ${tenant._id}\n`);
		process.stdout.write(`status: ${tenant.status}\n`);
		const counts = await countTenantData(connection.db, tenant._id);
		for (const { collection, count } of counts) {
			process.stdout.write(`${collection}: ${count}\n`);
		}
		if (!confirm) {
			process.stdout.write("Counts only: run again with --confirm to delete\n");
			return 0;
		}
		await purgeTenantData(connection.db, tenant._id);
		const left = (await countTenantData(connection.db, tenant._id)).reduce(
			(sum, { count }) => sum + count,
			0,
		);
		process.stdout.write(`Deleted; documents left: ${left}\n`);
		return left === 0 ? 0 : 1;
	} finally {
		await connection.client.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`purge-tenant failed: ${message}\n`);
		process.exit(1);
	},
);
