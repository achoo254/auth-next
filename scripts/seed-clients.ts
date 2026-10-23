/**
 * Checks that this environment serves the static OIDC clients, for staging
 * and production after each deploy:
 *
 *   pnpm seed:clients                    (reads the same env as the server)
 *   pnpm seed:clients --skip-discovery   (before the IdP is reachable)
 *
 * Static clients are defined in code and built from the environment, so
 * there is nothing to write: the script validates each client with
 * oidc-provider, reports DCR clients and any MongoDB record shadowing a
 * static id, prints the plan with a fingerprint, and (unless skipped)
 * checks the deployed discovery document and JWKS. It never writes and
 * never prints a secret; running it twice gives the same output. Exit code
 * 1 when anything is wrong.
 */
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import {
	checkDiscovery,
	formatSeedReport,
	inspectStaticClients,
} from "../src/oidc/client-seed.js";
import {
	loadSigningJwks,
	primarySigningKey,
	rsaSigningKey,
} from "../src/oidc/jwks.js";

async function main(): Promise<number> {
	const env = parseEnv(process.env);
	const jwks = await loadSigningJwks(env.SIGNING_KEYS_PATH);
	const connection = await connectMongo(env.MONGO_URL, createLogger("warn"));
	try {
		const report = await inspectStaticClients({
			env,
			db: connection.db,
			jwks,
		});
		process.stdout.write(`${formatSeedReport(report)}\n`);
		const problems = [...report.shadowedIds].map(
			(id) => `MongoDB holds a client record for static id ${id}`,
		);
		const signingKids = [primarySigningKey(jwks), rsaSigningKey(jwks)]
			.filter((key) => key !== undefined)
			.map((key) => key.kid);
		if (process.argv.includes("--skip-discovery")) {
			process.stdout.write("Discovery: skipped\n");
		} else {
			problems.push(...(await checkDiscovery(env.ISSUER, signingKids)));
			process.stdout.write(`Discovery: checked ${env.ISSUER}\n`);
		}
		for (const problem of problems) {
			process.stderr.write(`Problem: ${problem}\n`);
		}
		return problems.length === 0 ? 0 : 1;
	} finally {
		await connection.client.close();
	}
}

main().then(
	// exitCode, not exit(): exiting with fetch sockets still open aborts libuv on Windows.
	(code) => {
		process.exitCode = code;
	},
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`seed-clients failed: ${message}\n`);
		process.exitCode = 1;
	},
);
