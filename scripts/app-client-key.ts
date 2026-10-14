/**
 * Writes the key one app needs to compute its client secret per tenant
 * (ADR 0006), derived from APP_CLIENT_SECRET_KEY:
 *
 *   node --env-file=.env dist/app-client-key.mjs localman-web <out-file>
 *   node --env-file=.env dist/app-client-key.mjs tunelo-web <out-file>
 *   node --env-file=.env dist/app-client-key.mjs chat-web <out-file>
 *
 * The key goes to a new file (mode 600) for the app's own secret store,
 * never to the terminal.
 */
import { writeFile } from "node:fs/promises";
import { parseEnv } from "../src/config/env.js";
import { STATIC_CLIENT_IDS } from "../src/oidc/clients.js";
import { appClientKey } from "../src/tenants/app-client-secrets.js";

const APPS: readonly string[] = [
	STATIC_CLIENT_IDS.localmanWeb,
	STATIC_CLIENT_IDS.tuneloWeb,
	STATIC_CLIENT_IDS.chatWeb,
];

async function main(): Promise<void> {
	const [clientId, outFile] = process.argv.slice(2);
	if (!clientId || !APPS.includes(clientId) || !outFile) {
		throw new Error(`usage: app-client-key <${APPS.join("|")}> <out-file>`);
	}
	const master = parseEnv(process.env).APP_CLIENT_SECRET_KEY;
	if (!master) throw new Error("APP_CLIENT_SECRET_KEY is not set");
	await writeFile(outFile, `${appClientKey(master, clientId)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	process.stdout.write(`Wrote the ${clientId} key to ${outFile}\n`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`app-client-key failed: ${message}\n`);
	process.exit(1);
});
