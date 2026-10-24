import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OwnershipResolver } from "../tenants/ownership-records.js";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import {
	type MultiTenantServer,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";
import { signedInAdmin } from "./helpers/tenant-admin-client.js";

/*
 * /admin's Scribe section (ADR 0012): AI keys are checked with their
 * provider, sealed for Scribe and never shown back; the first
 * transcription key turns Scribe on, removing the last turns it off.
 */

const IP = "203.0.113.65";
/** A records the fake DNS knows (scribe.acme.example.org added later). */
const aRecords = new Map<string, string[]>();
const resolver: OwnershipResolver = {
	resolveTxt: async () => [],
	resolve4: async (name) => {
		const found = aRecords.get(name);
		if (found) return found;
		throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
	},
};
const OWNER = { provider: "google", providerId: "g-scribe-owner" } as const;
/** Made-up keys (never real credentials). */
const fake = (prefix: string, tail: string): string =>
	[prefix, "admin", "scribe", "0123456789", tail].join("-");
const GOOD_OPENAI = fake("sk", "good");
const GOOD_ANTHROPIC = fake("sk-ant", "good");
const NO_CREDIT = fake("el", "poor");
/** The form a key is posted with (its field is redacted in logs). */
const KEY_FIELD = "apiKey";
const keyForm = (csrf: string, value: string): Record<string, string> => ({
	csrf,
	[KEY_FIELD]: value,
});

/** The AI providers as the probes reach them. */
const providers: typeof fetch = async (input, init) => {
	const url = String(input);
	const headers = new Headers(init?.headers);
	if (url.startsWith("https://generativelanguage.googleapis.com/")) {
		throw new TypeError("fetch failed");
	}
	if (headers.get("xi-api-key") === NO_CREDIT) {
		return Response.json(
			{ detail: { code: "insufficient_credits" } },
			{ status: 402 },
		);
	}
	const good =
		headers.get("authorization") === `Bearer ${GOOD_OPENAI}` ||
		headers.get("x-api-key") === GOOD_ANTHROPIC;
	return Response.json({ data: [] }, { status: good ? 200 : 401 });
};

async function startWith(
	extraEnv: Record<string, string>,
): Promise<{ server: MultiTenantServer; tenant: TenantDocument }> {
	const server = await startMultiTenantServer(
		{ SERVICE_IPV4: IP, ...extraEnv },
		{ fetch: providers, resolver },
	);
	const added = await server.addTenant("acme.example.org", "claimed");
	await server.db
		.collection("tenants")
		.updateOne({ _id: added._id as never }, { $set: { owner: OWNER } });
	return { server, tenant: { ...added, owner: OWNER } };
}

let keyDir: string;
let server: MultiTenantServer;
let tenant: TenantDocument;
let admin: Awaited<ReturnType<typeof signedInAdmin>>;

beforeAll(async () => {
	keyDir = await mkdtemp(join(tmpdir(), "scribe-sealing-"));
	const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
	await writeFile(
		join(keyDir, "scribe.pem"),
		publicKey.export({ type: "spki", format: "pem" }),
	);
	({ server, tenant } = await startWith({
		SCRIBE_TENANTS: "true",
		SCRIBE_SEALING_PUBLIC_KEY_PATH: join(keyDir, "scribe.pem"),
	}));
	admin = await signedInAdmin(server, tenant);
});

afterAll(async () => {
	await server?.close();
	await rm(keyDir, { recursive: true, force: true });
});

async function save(vendor: string, value: string): Promise<string | null> {
	const { csrf } = await admin.page();
	const response = await admin.client.request(
		`/admin/scribe/${vendor}`,
		keyForm(csrf, value),
	);
	return response.headers.get("location");
}

const current = async () => server.registry.findById(tenant._id);

describe("/admin Scribe section", () => {
	it("shows the DNS record Scribe needs and who pays, while off", async () => {
		const { html } = await admin.page();
		expect(html).toContain('data-id="account-admin-scribe"');
		expect(html).toContain(`A scribe.acme.example.org → ${IP}`);
		expect(html).toContain('data-id="admin-scribe-billing"');
		expect(html).toContain("Add a transcription key below");
	});

	it("needs the session's CSRF token", async () => {
		const response = await admin.client.request(
			"/admin/scribe/openai",
			keyForm("", GOOD_OPENAI),
		);
		expect(response.headers.get("location")).toBe("/admin");
		expect(await server.secrets.sealedForScribe(tenant._id)).toEqual([]);
	});

	it("saves nothing the provider does not accept", async () => {
		expect(await save("openai", "not-an-openai-key-0123456789")).toBe(
			"/admin?result=invalid",
		);
		expect(await save("openai", fake("sk", "wrong"))).toBe(
			"/admin?result=scribe-key-invalid",
		);
		expect(await save("elevenlabs", NO_CREDIT)).toBe(
			"/admin?result=scribe-key-no-credit",
		);
		expect(await save("gemini", fake("AIza", "down"))).toBe(
			"/admin?result=scribe-key-unreachable",
		);
		expect(await save("mistral", GOOD_OPENAI)).toBe(null);
		expect(await server.secrets.sealedForScribe(tenant._id)).toEqual([]);
		expect((await current())?.scribe).toBeUndefined();
	});

	it("keeps a text-only key without turning Scribe on", async () => {
		expect(await save("anthropic", GOOD_ANTHROPIC)).toBe("/admin?result=saved");
		expect((await current())?.scribe).toBeUndefined();
	});

	it("turns Scribe on with a transcription key, showing only its last 4 characters", async () => {
		// Saved, but scribe.<domain> has no record yet: no certificate queued.
		expect(await save("openai", GOOD_OPENAI)).toBe(
			"/admin?result=scribe-dns-wrong",
		);
		expect((await current())?.scribeCertificate).toBeUndefined();
		expect((await current())?.scribe?.enabledAt).toBeInstanceOf(Date);
		const { html } = await admin.page();
		expect(html).toContain(`••••${GOOD_OPENAI.slice(-4)}`);
		expect(html).toContain("https://scribe.acme.example.org");
		expect(html).not.toContain(GOOD_OPENAI);
		expect(html).not.toContain(GOOD_ANTHROPIC);
		const audit = await server.db
			.collection("audit_outbox")
			.find({ tenantId: tenant._id, type: "tenant.configured" })
			.toArray();
		expect(audit.map((event) => event.data?.setting)).toEqual(
			expect.arrayContaining(["scribe-anthropic", "scribe-openai"]),
		);
		expect(JSON.stringify(audit)).not.toContain(GOOD_OPENAI);
	});

	it("queues the scribe.<domain> certificate once Check DNS finds the record", async () => {
		const { html, csrf } = await admin.page();
		expect(html).toContain('data-id="admin-scribe-check-dns"');
		const missing = await admin.client.request("/admin/scribe/dns", { csrf });
		expect(missing.headers.get("location")).toBe(
			"/admin?result=scribe-dns-wrong",
		);
		aRecords.set("scribe.acme.example.org", [IP]);
		const found = await admin.client.request("/admin/scribe/dns", {
			csrf: (await admin.page()).csrf,
		});
		expect(found.headers.get("location")).toBe("/admin?result=scribe-dns-ok");
		expect((await current())?.scribeCertificate).toMatchObject({
			status: "pending",
			attempts: 0,
		});
		const after = await admin.page();
		expect(after.html).toContain('data-id="admin-scribe-certificate"');
		expect(after.html).toContain("Certificate of scribe.: being issued.");
	});

	it("shows what Scribe reported about a key", async () => {
		const saved = (await server.secrets.sealedForScribe(tenant._id)).find(
			(k) => k.vendor === "openai",
		);
		await server.secrets.setScribeStatus(
			tenant._id,
			"openai",
			{ recipient: saved?.sealed.recipient ?? "", tag: saved?.sealed.tag },
			"quota",
		);
		const { html } = await admin.page();
		expect(html).toContain("this OpenAI account is out of credit");
	});

	it("turns Scribe off with the last transcription key", async () => {
		const { csrf } = await admin.page();
		const removed = await admin.client.request("/admin/scribe/openai/remove", {
			csrf,
		});
		expect(removed.headers.get("location")).toBe("/admin?result=saved");
		expect((await current())?.scribe).toBeUndefined();
		const left = await server.secrets.sealedForScribe(tenant._id);
		expect(left.map((k) => k.vendor)).toEqual(["anthropic"]);
	});
});

describe("/admin without Scribe on tenants", () => {
	it("has no Scribe section and no Scribe routes", async () => {
		const off = await startWith({ SCRIBE_TENANTS: "false" });
		try {
			const offAdmin = await signedInAdmin(off.server, off.tenant);
			const { html, csrf } = await offAdmin.page();
			expect(html).toContain('data-id="admin-save-name"');
			expect(html).not.toContain("account-admin-scribe");
			const response = await offAdmin.client.request(
				"/admin/scribe/openai",
				keyForm(csrf, GOOD_OPENAI),
			);
			expect(response.status).toBe(404);
		} finally {
			await off.server.close();
		}
	});
});
