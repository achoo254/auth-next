/**
 * Generates a signing key and appends it to the private JWKS file.
 *
 *   pnpm generate-key [path] [--alg ES256|RS256]
 *   (default: secrets/signing-keys.json, ES256)
 *
 * The first key of each algorithm signs with it; a later one is published
 * for verification only, until it is moved before the others of its
 * algorithm in a later deploy (see docs/decisions/0001-own-oidc-idp.md and
 * 0005-rs256-id-tokens.md). The file must keep an ES256 key, so a new file
 * starts with ES256. Key material is never printed.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	RSA_ID_TOKEN_ALG,
	SIGNING_ALG,
	type SigningAlg,
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

function parseArgs(args: readonly string[]): { path: string; alg: SigningAlg } {
	let path = DEFAULT_PATH;
	let alg: SigningAlg = SIGNING_ALG;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--alg") {
			const value = args[index + 1];
			if (value !== SIGNING_ALG && value !== RSA_ID_TOKEN_ALG) {
				throw new Error(`--alg must be ${SIGNING_ALG} or ${RSA_ID_TOKEN_ALG}`);
			}
			alg = value;
			index += 1;
		} else if (arg !== undefined) {
			path = arg;
		}
	}
	return { path: resolve(path), alg };
}

async function main(): Promise<void> {
	const { path, alg } = parseArgs(process.argv.slice(2));
	const keys = await readExistingKeys(path);
	const key = await generateSigningJwk(alg);
	if (keys.some((existing) => existing.kid === key.kid)) {
		throw new Error("Generated a duplicate kid; run the script again");
	}
	const signs = !keys.some((existing) => existing.alg === alg);
	keys.push(key);
	// Refuse to write a file the server would refuse to start with.
	parseSigningJwks({ keys });

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

	const role = signs ? `signing ${alg}` : "verification only";
	process.stdout.write(
		`Added ${alg} key kid=${key.kid} (${role}) to ${path}; the file now holds ${keys.length} key(s).\n`,
	);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`generate-signing-key failed: ${message}\n`);
	process.exit(1);
});
