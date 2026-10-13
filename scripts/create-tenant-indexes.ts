/**
 * Creates every index the server needs (the per-tenant ones included)
 * before a deploy, so the server's own startup index pass is a no-op and
 * the new release starts within the release switch's wait:
 *
 *   node dist/create-tenant-indexes.mjs     (reads the same env as the server)
 *
 * Idempotent: indexes that exist are left as they are. Prints how long each
 * group took; never prints a secret. Old single-tenant unique indexes are
 * not touched here.
 */
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { ensureOidcIndexes } from "../src/oidc/oidc-indexes.js";
import { ensureAccountLayerIndexes } from "../src/services.js";
import { ensureTenantRegistryIndexes } from "../src/tenants/tenant-registry.js";

async function timed(label: string, run: () => Promise<void>): Promise<void> {
	const started = performance.now();
	await run();
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	process.stdout.write(`${label}: done in ${seconds}s\n`);
}

async function main(): Promise<void> {
	const env = parseEnv(process.env);
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		await timed("oidc_* indexes", () => ensureOidcIndexes(connection.db));
		await timed("account layer indexes", () =>
			ensureAccountLayerIndexes(connection.db),
		);
		await timed("tenant registry indexes", () =>
			ensureTenantRegistryIndexes(connection.db),
		);
	} finally {
		await connection.client.close();
	}
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`create-tenant-indexes failed: ${message}\n`);
		process.exit(1);
	},
);
