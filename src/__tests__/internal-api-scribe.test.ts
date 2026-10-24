import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recipientOf } from "../tenants/secret-keyring.js";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import {
	INTERNAL_SECRETS,
	type MultiTenantServer,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";

/*
 * What Scribe reads from the internal API: a host's tenant, its keys and
 * discovery, and (ADR 0012) the tenant's AI keys sealed for Scribe only.
 */
let server: MultiTenantServer;
let acme: TenantDocument;
let beta: TenantDocument;
const scribePem = generateKeyPairSync("rsa", { modulusLength: 2048 })
	.publicKey.export({ type: "spki", format: "pem" })
	.toString();
const recipient = recipientOf(scribePem);
/** A made-up key (never a real credential). */
const fakeKey = ["sk", "internal", "scribe", "0123456789", "Wxyz"].join("-");

beforeAll(async () => {
	server = await startMultiTenantServer({ SCRIBE_TENANTS: "true" });
	acme = await server.addTenant("acme.example.org");
	beta = await server.addTenant("beta.example.org");
	await server.registry.setScribeEnabled(acme._id, true);
	await server.secrets.putForScribe(acme._id, "openai", fakeKey, scribePem);
	await server.secrets.putForScribe(beta._id, "openai", fakeKey, scribePem);
});

afterAll(async () => {
	await server?.close();
});

const basic = (role: string, secret: string) => ({
	authorization: `Basic ${Buffer.from(`${role}:${secret}`).toString("base64")}`,
});
const asScribe = basic("scribe", INTERNAL_SECRETS.scribe);

function internal(
	path: string,
	init: RequestInit = {},
	headers: Record<string, string> = asScribe,
): Promise<Response> {
	return fetch(`${server.internalOrigin}${path}`, {
		...init,
		headers: { ...headers, ...(init.headers as Record<string, string>) },
	});
}

function report(tenantId: string, vendor: string, body: unknown) {
	return internal(
		`/internal/tenants/${tenantId}/scribe-keys/${vendor}/status`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		},
	);
}

describe("internal API for Scribe", () => {
	it("looks up a host's tenant, with Scribe only where it is on", async () => {
		const primary = await internal(
			"/internal/tenants/lookup?host=scribe.hoandat.com",
		);
		expect(await primary.json()).toMatchObject({
			id: "primary",
			issuer: server.env.ISSUER,
		});
		const on = await internal(
			"/internal/tenants/lookup?host=scribe.acme.example.org",
		);
		expect(await on.json()).toMatchObject({
			id: acme._id,
			webApps: { scribe: "https://scribe.acme.example.org" },
		});
		const off = await internal(
			"/internal/tenants/lookup?host=scribe.beta.example.org",
		);
		const body = (await off.json()) as { webApps: Record<string, string> };
		expect(body.webApps.scribe).toBeUndefined();
	});

	it("reads a tenant's keys and discovery, not the certificate queue", async () => {
		const jwks = await internal(`/internal/tenants/${acme._id}/jwks`);
		expect(jwks.status).toBe(200);
		const discovery = await internal(
			`/internal/tenants/${acme._id}/openid-configuration`,
		);
		expect(await discovery.json()).toMatchObject({
			issuer: "https://auth.acme.example.org",
		});
		for (const [path, method] of [
			["/internal/certificates/work", "GET"],
			[`/internal/certificates/${acme._id}`, "POST"],
		] as const) {
			const response = await internal(path, { method });
			expect(response.status, `${method} ${path}`).toBe(401);
		}
	});

	it("needs Scribe's own secret", async () => {
		const response = await internal(
			"/internal/tenants/lookup?host=scribe.hoandat.com",
			{},
			basic("scribe", INTERNAL_SECRETS.localman),
		);
		expect(response.status).toBe(401);
	});

	it("hands out a tenant's AI keys sealed, never in plaintext", async () => {
		const response = await internal(
			`/internal/tenants/${acme._id}/scribe-keys`,
		);
		const text = await response.text();
		expect(text).not.toContain(fakeKey);
		expect(JSON.parse(text)).toEqual({
			keys: [
				{
					vendor: "openai",
					hint: "Wxyz",
					updatedAt: expect.any(String),
					sealed: {
						kid: "recipient",
						iv: expect.any(String),
						ciphertext: expect.any(String),
						tag: expect.any(String),
						wrappedKey: expect.any(String),
						recipient,
					},
				},
			],
		});
	});

	it("hands out no keys while the tenant has not turned Scribe on", async () => {
		const response = await internal(
			`/internal/tenants/${beta._id}/scribe-keys`,
		);
		expect(await response.json()).toEqual({ keys: [] });
	});

	it("knows only tenants served here", async () => {
		for (const status of ["suspended", "migrating"] as const) {
			const gone = await server.addTenant(`${status}.example.org`, status);
			await server.registry.setScribeEnabled(gone._id, true);
			const response = await internal(
				`/internal/tenants/${gone._id}/scribe-keys`,
			);
			expect(response.status, status).toBe(404);
		}
		const unknown = await internal("/internal/tenants/ten_nobody/scribe-keys");
		expect(unknown.status).toBe(404);
	});

	it("gives AI keys to Scribe alone", async () => {
		for (const [role, secret] of [
			["localman", INTERNAL_SECRETS.localman],
			["provisioner", INTERNAL_SECRETS.provisioner],
		] as const) {
			const headers = basic(role, secret);
			const keys = await internal(
				`/internal/tenants/${acme._id}/scribe-keys`,
				{},
				headers,
			);
			expect(keys.status, role).toBe(401);
			const status = await internal(
				`/internal/tenants/${acme._id}/scribe-keys/openai/status`,
				{ method: "POST" },
				headers,
			);
			expect(status.status, role).toBe(401);
		}
	});

	it("records a report only in the expected shape and for the stored key", async () => {
		for (const [vendor, body] of [
			["openai", { status: "broken", recipient }],
			["openai", { status: "invalid", recipient: "not-hex" }],
			["openai", { status: "invalid" }],
			["mistral", { status: "invalid", recipient }],
		] as const) {
			expect((await report(acme._id, vendor, body)).status).toBe(400);
		}
		const stale = await report(acme._id, "openai", {
			status: "invalid",
			recipient: "0123456789abcdef",
		});
		expect(stale.status).toBe(204);
		const statusOf = async (id: string) =>
			(await server.secrets.sealedForScribe(id)).find(
				(key) => key.vendor === "openai",
			)?.status;
		expect(await statusOf(acme._id)).toBeUndefined();
		expect(
			(await report(acme._id, "openai", { status: "quota", recipient })).status,
		).toBe(204);
		expect(await statusOf(acme._id)).toBe("quota");
		// Scribe off on beta: nothing is recorded there.
		await report(beta._id, "openai", { status: "invalid", recipient });
		expect(await statusOf(beta._id)).toBeUndefined();
	});
});

describe("internal API with Scribe on tenants off", () => {
	it("shows no tenant Scribe and hands out no keys", async () => {
		const off = await startMultiTenantServer();
		try {
			const tenant = await off.addTenant("acme.example.org");
			await off.registry.setScribeEnabled(tenant._id, true);
			await off.secrets.putForScribe(tenant._id, "openai", fakeKey, scribePem);
			const get = (path: string) =>
				fetch(`${off.internalOrigin}${path}`, { headers: asScribe });
			const keys = await get(`/internal/tenants/${tenant._id}/scribe-keys`);
			expect(await keys.json()).toEqual({ keys: [] });
			const lookup = await get(
				"/internal/tenants/lookup?host=scribe.acme.example.org",
			);
			const body = (await lookup.json()) as { webApps: Record<string, string> };
			expect(body.webApps.scribe).toBeUndefined();
		} finally {
			await off.close();
		}
	});
});
