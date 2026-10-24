import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A test-only RSA-3072 key pair of Scribe, its public half in a file for
 * SCRIBE_SEALING_PUBLIC_KEY_PATH (SCRIBE_TENANTS needs it).
 */
export async function writeScribeSealingKey(): Promise<{
	readonly path: string;
	readonly publicKeyPem: string;
	remove(): Promise<void>;
}> {
	const dir = await mkdtemp(join(tmpdir(), "scribe-sealing-"));
	const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
	const publicKeyPem = publicKey
		.export({ type: "spki", format: "pem" })
		.toString();
	const path = join(dir, "scribe.pem");
	await writeFile(path, publicKeyPem);
	return {
		path,
		publicKeyPem,
		remove: () => rm(dir, { recursive: true, force: true }),
	};
}
