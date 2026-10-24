/**
 * Finishes deleting an account of the primary tenant whose deletion
 * stopped half way (ADR 0009): the account is disabled, so it no longer
 * signs in, but some of its documents are still there. Only the database
 * steps run again. Revoking at Apple and back-channel logout are not
 * retried; the script says when the account had an Apple link.
 *
 *   node --env-file=.env dist/finish-account-deletion.mjs <accountId>            shows the account
 *   node --env-file=.env dist/finish-account-deletion.mjs <accountId> --confirm  deletes
 *
 * Back up the database first (infra/backup-auth-db.sh).
 */
import { finishAccountDeletion } from "../src/account-portal/account-deletion.js";
import { AccountRepository } from "../src/accounts/account-repository.js";
import { AuditOutbox } from "../src/audit/audit-outbox.js";
import { parseEnv } from "../src/config/env.js";
import { connectMongo } from "../src/db/connect-mongo.js";
import { createLogger } from "../src/logger.js";
import { PRIMARY_TENANT_ID } from "../src/tenants/env-tenant.js";

async function main(): Promise<number> {
	const [accountId] = process.argv.slice(2);
	if (!accountId || accountId.startsWith("--")) {
		throw new Error("usage: finish-account-deletion <accountId> [--confirm]");
	}
	const confirm = process.argv.includes("--confirm");
	const env = parseEnv(process.env);
	const logger = createLogger("warn");
	const connection = await connectMongo(env.MONGO_URL, logger);
	try {
		const { db } = connection;
		const tenant = { id: PRIMARY_TENANT_ID };
		const accounts = new AccountRepository(
			db,
			tenant,
			new AuditOutbox(db, tenant, logger),
		);
		const account = await accounts.findIncludingDisabled(accountId);
		if (!account) throw new Error(`no account ${accountId}`);
		if (!account.disabledAt) {
			throw new Error(
				`${accountId} is in use (not disabled): delete it at /account`,
			);
		}
		process.stdout.write(
			`account ${accountId} disabled at ${account.disabledAt.toISOString()}\n`,
		);
		if (account.providerDetails?.apple?.revocationToken) {
			process.stdout.write(
				"Apple link: revoking at Apple may not have happened; the person can remove it in their Apple ID settings\n",
			);
		}
		if (!confirm) {
			process.stdout.write("Nothing deleted: run again with --confirm\n");
			return 0;
		}
		const counts = await finishAccountDeletion(
			{ db, tenant, accounts },
			accountId,
		);
		for (const { collection, count } of counts) {
			process.stdout.write(`${collection}: ${count}\n`);
		}
		return 0;
	} finally {
		await connection.client.close();
	}
}

main().then(
	(code) => process.exit(code),
	(error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`finish-account-deletion failed: ${message}\n`);
		process.exit(1);
	},
);
