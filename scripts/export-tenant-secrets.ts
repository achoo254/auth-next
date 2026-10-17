/**
 * Seals the secrets of a tenant moving to its own servers (ADR 0007 §7)
 * to its install's migration key, on the server it moves from:
 *
 *   node --env-file=.env dist/export-tenant-secrets.mjs <domain> <migration-key.pub.json> <out-file>
 *
 * The tenant must be `migrating` (its owner started the move at /claim).
 * The out file (mode 600) opens only with the install's private key; no
 * secret is ever printed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { sealTenantSecrets } from "../src/tenants/migration-secrets.js";
import { parseKeyring } from "../src/tenants/secret-keyring.js";
import { TenantRegistry } from "../src/tenants/tenant-registry.js";
import { TenantSecrets } from "../src/tenants/tenant-secrets.js";

async function main(): Promise<void> {
	const [domain, publicKeyPath, outFile] = process.argv.slice(2);
	if (!domain || !publicKeyPath || !outFile) {
		throw new Error(
			"usage: export-tenant-secrets <domain> <migration-key.pub.json> <out-file>",
		);
	}
	const env = parseEnv(process.env);
	const keyring = parseKeyring(env.TENANT_SECRETS_KEY);
	if (!keyring) throw new Error("TENANT_SECRETS_KEY is not set");
	const installKey: unknown = JSON.parse(await readFile(publicKeyPath, "utf8"));
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const tenant = await new TenantRegistry(connection.db).findByDomain(domain);
		if (tenant?.status !== "migrating") {
			throw new Error(
				`${domain} is not a tenant being moved (status: ${tenant?.status ?? "none"})`,
			);
		}
		const sealed = await sealTenantSecrets(
			new TenantSecrets(connection.db, keyring),
			{ id: tenant._id, domain: tenant.domain },
			installKey,
		);
		await writeFile(outFile, `${sealed}\n`, { mode: 0o600, flag: "wx" });
		process.stdout.write(
			`Sealed the secrets of ${domain} (${tenant._id}) to ${outFile}\n`,
		);
	} finally {
		await connection.client.close();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`export-tenant-secrets failed: ${message}\n`);
	process.exit(1);
});
