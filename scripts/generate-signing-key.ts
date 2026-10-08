/**
 * Generates an ES256 signing key and appends it to the private JWKS file.
 *
 *   pnpm generate-key [path]   (default: secrets/signing-keys.json)
 *
 * A new file starts with the generated key, which then signs. In an existing
 * file the key is appended, so it is published for verification only; move
 * it to the front of "keys" in a later deploy to start signing with it (see
 * docs/decisions/0001-own-oidc-idp.md). Key material is never printed.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	type SigningJwk,
	generateSigningJwk,
	parseSigningJwks,
} from "../src/oidc/jwks.js";

const DEFAULT_PATH = "secrets/signing-keys.json";

async function readExistingKeys(path: string): Promise<SigningJwk[]> {
	if (!existsSync(path)) return [];
	const document: unknown = JSON.parse(await readFile(path, "utf8"));
	return [...parseSigningJwks(document).keys];
}

async function main(): Promise<void> {
	const path = resolve(process.argv[2] ?? DEFAULT_PATH);
	const keys = await readExistingKeys(path);
	const key = await generateSigningJwk();
	if (keys.some((existing) => existing.kid === key.kid)) {
		throw new Error("Generated a duplicate kid; run the script again");
	}
	keys.push(key);

	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	// Write a sibling temp file, then rename: a crash or full disk never
	// leaves a truncated JWKS behind, and readers see old or new, not half.
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, `${JSON.stringify({ keys }, null, "\t")}\n`, {
			mode: 0o600,
			flag: "wx",
		});
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}

	const role = keys.length === 1 ? "signing" : "verification only";
	process.stdout.write(
		`Added key kid=${key.kid} (${role}) to ${path}; the file now holds ${keys.length} key(s).\n`,
	);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`generate-signing-key failed: ${message}\n`);
	process.exit(1);
});
