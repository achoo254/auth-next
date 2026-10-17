/**
 * Takes a moved tenant into a self-hosted install (ADR 0007 §7), after its
 * IdP collections were restored into the install's database:
 *
 *   node --env-file=.env dist/import-tenant.mjs <secrets.jwe> <migration-key.json> <signing-keys-out> <settings-out>
 *
 * Opens the sealed secrets with the install's migration key, writes the
 * tenant's signing keys (same kids: tokens it issued stay valid) and its
 * OAuth and bot settings (for the install's .env), both mode 600, then
 * gives the restored documents to the install's primary tenant. Prints
 * counts and names, never a value.
 */
import { readFile, writeFile } from "node:fs/promises";
import { ACCOUNTS_COLLECTION } from "../src/accounts/user-model.js";
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { PRIMARY_TENANT_ID } from "../src/tenants/env-tenant.js";
import { openTenantSecrets } from "../src/tenants/migration-secrets.js";
import {
	countTenantData,
	retagTenantData,
} from "../src/tenants/tenant-collections.js";

async function main(): Promise<void> {
	const [sealedPath, keyPath, signingOut, settingsOut] = process.argv.slice(2);
	if (!sealedPath || !keyPath || !signingOut || !settingsOut) {
		throw new Error(
			"usage: import-tenant <secrets.jwe> <migration-key.json> <signing-keys-out> <settings-out>",
		);
	}
	const env = parseEnv(process.env);
	const privateKey: unknown = JSON.parse(await readFile(keyPath, "utf8"));
	if (typeof privateKey !== "object" || privateKey === null) {
		throw new Error("unreadable migration key");
	}
	const moved = await openTenantSecrets(
		await readFile(sealedPath, "utf8"),
		privateKey,
	);
	if (moved.domain !== env.TENANT_DOMAIN) {
		throw new Error(
			`the secrets are for ${moved.domain}, this install serves ${env.TENANT_DOMAIN}`,
		);
	}
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const accounts = (
			await countTenantData(connection.db, PRIMARY_TENANT_ID)
		).find(({ collection }) => collection === ACCOUNTS_COLLECTION);
		if (accounts && accounts.count > 0) {
			throw new Error(
				`this install already has ${accounts.count} accounts; import into a fresh one`,
			);
		}
		await writeFile(
			signingOut,
			`${JSON.stringify(moved.signingKeys, null, 2)}\n`,
			{ mode: 0o600 },
		);
		const settings = Object.entries(moved.settings).map(
			([name, value]) => `${name}=${value}`,
		);
		await writeFile(settingsOut, `${settings.join("\n")}\n`, { mode: 0o600 });
		process.stdout.write(
			`Signing keys: ${moved.signingKeys.keys.length}; settings: ${Object.keys(moved.settings).join(", ") || "none"}\n`,
		);
		const counts = await retagTenantData(
			connection.db,
			moved.tenantId,
			PRIMARY_TENANT_ID,
		);
		for (const { collection, count } of counts) {
			process.stdout.write(`${collection}: ${count}\n`);
		}
	} finally {
		await connection.client.close();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`import-tenant failed: ${message}\n`);
	process.exit(1);
});
