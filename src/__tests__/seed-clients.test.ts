import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	checkDiscovery,
	formatSeedReport,
	inspectStaticClients,
} from "../oidc/client-seed.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	CHAT_WEB_SECRET,
	LOCALMAN_WEB_SECRET,
	SCRIBE_WEB_DEV_SECRET,
	SCRIBE_WEB_SECRET,
	TUNELO_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

const run = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, "../../scripts/seed-clients.ts");

let idp: TestIdp;
let dir: string;
let keysPath: string;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto", rateLimits: [] });
	dir = await mkdtemp(join(tmpdir(), "hoandat-auth-seed-"));
	keysPath = join(dir, "signing-keys.json");
	await writeFile(keysPath, JSON.stringify(idp.jwks), { mode: 0o600 });
	// One MCP client, so the report has a dynamic client to count.
	await client.dynamicClientRegistration(
		new URL(idp.issuer),
		{
			redirect_uris: ["http://127.0.0.1:33418/callback"],
			token_endpoint_auth_method: "none",
		},
		client.None(),
		{ execute: [client.allowInsecureRequests] },
	);
});

afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
	await idp?.close();
});

/** Every collection's documents and indexes, to prove nothing was written. */
async function snapshot(): Promise<string> {
	const collections = await idp.db.listCollections().toArray();
	const names = collections.map((entry) => entry.name).sort();
	const state = await Promise.all(
		names.map(async (name) => {
			const collection = idp.db.collection(name);
			return {
				name,
				documents: await collection.find({}).sort({ _id: 1 }).toArray(),
				indexes: await collection.indexes(),
			};
		}),
	);
	return JSON.stringify(state);
}

function seed(args: readonly string[], env: Record<string, string> = {}) {
	return run(process.execPath, ["--import", "tsx", SCRIPT, ...args], {
		env: {
			PATH: process.env.PATH ?? "",
			NODE_ENV: "test",
			ISSUER: idp.issuer,
			MONGO_URL: idp.env.MONGO_URL,
			SIGNING_KEYS_PATH: keysPath,
			COOKIE_KEYS: idp.env.COOKIE_KEYS.join(","),
			LOCALMAN_WEB_CLIENT_SECRET: LOCALMAN_WEB_SECRET,
			TUNELO_WEB_CLIENT_SECRET: TUNELO_WEB_SECRET,
			CHAT_WEB_CLIENT_SECRET: CHAT_WEB_SECRET,
			...env,
		},
	});
}

describe("seed-clients", () => {
	it("reports every static client without writing, identically twice", async () => {
		const before = await snapshot();
		const deps = { env: idp.env, db: idp.db, jwks: idp.jwks };
		const first = await inspectStaticClients(deps);
		const second = await inspectStaticClients(deps);
		expect(second).toEqual(first);
		expect(await snapshot()).toBe(before);

		expect(first.clients.map((entry) => entry.clientId)).toEqual(
			Object.values(STATIC_CLIENT_IDS),
		);
		expect(first.dynamicClients).toBe(1);
		expect(first.shadowedIds).toEqual([]);
		const text = formatSeedReport(first);
		expect(text).not.toContain(LOCALMAN_WEB_SECRET);
		expect(text).not.toContain(TUNELO_WEB_SECRET);
		expect(text).not.toContain(CHAT_WEB_SECRET);
		expect(text).not.toContain(SCRIBE_WEB_SECRET);
		expect(text).not.toContain(SCRIBE_WEB_DEV_SECRET);
	});

	it("leaves Scribe out of the report when it is not configured", async () => {
		const { stdout } = await seed(["--skip-discovery"]);
		expect(stdout).toContain("- chat-web");
		expect(stdout).not.toContain("scribe");
		const configured = await seed(["--skip-discovery"], {
			SCRIBE_WEB_CLIENT_SECRET: SCRIBE_WEB_SECRET,
		});
		expect(configured.stdout).toContain('- scribe-web "Scribe"');
		expect(configured.stdout).toContain(
			"back-channel logout https://scribe.hoandat.com/api/auth/backchannel-logout",
		);
		expect(configured.stdout).toContain(
			"redirect com.hoandat.scribe:/auth/callback",
		);
		expect(configured.stdout).not.toContain("scribe-web-dev");
		expect(configured.stdout).not.toContain(SCRIBE_WEB_SECRET);
	});

	it("flags a stored record that shadows a static client", async () => {
		const stored = idp.db.collection<{ _id: string; tenantId: string }>(
			collectionNameFor("Client"),
		);
		await stored.insertOne({
			_id: STATIC_CLIENT_IDS.tuneloWeb,
			tenantId: idp.tenant.id,
		});
		const report = await inspectStaticClients({
			env: idp.env,
			db: idp.db,
			jwks: idp.jwks,
		});
		await stored.deleteOne({ _id: STATIC_CLIENT_IDS.tuneloWeb });
		expect(report.shadowedIds).toEqual([STATIC_CLIENT_IDS.tuneloWeb]);
	});

	it("checks the live discovery document and JWKS", async () => {
		const kids = idp.jwks.keys.map((key) => key.kid);
		expect(await checkDiscovery(idp.issuer, kids)).toEqual([]);
		expect(await checkDiscovery(idp.issuer, ["unknown-kid"])).toEqual([
			expect.stringContaining("signing key unknown-kid is not published"),
		]);
	});

	it("runs as a script twice with the same output and no writes", async () => {
		const before = await snapshot();
		const first = await seed([]);
		const second = await seed([]);
		expect(second.stdout).toBe(first.stdout);
		expect(first.stdout).toContain("Writes: none");
		expect(first.stdout).toContain(`Discovery: checked ${idp.issuer}`);
		expect(first.stderr).toBe("");
		expect(await snapshot()).toBe(before);
		expect(first.stdout).not.toContain(LOCALMAN_WEB_SECRET);
	});

	it("fails without printing a secret when the environment is incomplete", async () => {
		await expect(
			seed(["--skip-discovery"], { TUNELO_WEB_CLIENT_SECRET: "" }),
		).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining("TUNELO_WEB_CLIENT_SECRET"),
		});
	});
});
