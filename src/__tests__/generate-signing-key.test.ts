import { execFile } from "node:child_process";
import {
	mkdtemp,
	readFile,
	readdir,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSigningJwks } from "../oidc/jwks.js";

const run = promisify(execFile);
const SCRIPT = resolve(
	import.meta.dirname,
	"../../scripts/generate-signing-key.ts",
);

let dir: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "hoandat-auth-genkey-"));
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
});

function generate(path: string): Promise<{ stdout: string }> {
	return run(process.execPath, ["--import", "tsx", SCRIPT, path]);
}

describe("generate-signing-key script", () => {
	it("creates the JWKS, then appends verification-only keys atomically", async () => {
		const path = join(dir, "secrets", "signing-keys.json");

		const first = await generate(path);
		expect(first.stdout).toMatch(/\(signing\)/);
		const second = await generate(path);
		expect(second.stdout).toMatch(/\(verification only\)/);

		const jwks = parseSigningJwks(JSON.parse(await readFile(path, "utf8")));
		expect(jwks.keys).toHaveLength(2);
		expect(`${first.stdout}${second.stdout}`).not.toContain(jwks.keys[0]?.d);
		expect((await stat(path)).mode & 0o777).toBe(0o600);
		// Only the final file remains; no temp file is left beside it.
		expect(await readdir(join(dir, "secrets"))).toEqual(["signing-keys.json"]);
	});

	it("refuses to touch a corrupt file", async () => {
		const path = join(dir, "broken.json");
		await writeFile(path, '{"keys":[]}');
		await expect(generate(path)).rejects.toMatchObject({ code: 1 });
		expect(await readFile(path, "utf8")).toBe('{"keys":[]}');
	});
});
