import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuditDeliveryResolver } from "../audit/audit-delivery.js";
import { AuditDispatcher } from "../audit/audit-dispatcher.js";
import type { AuditOutboxDocument } from "../audit/audit-outbox.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { allTenantsAuditQueue } from "../audit/audit-queue.js";
import { createLogger } from "../logger.js";
import { generateSigningJwk } from "../oidc/jwks.js";
import { certificateBackoffMs } from "../tenants/internal-certificates.js";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import { tenantFromDocument } from "../tenants/tenant-runtime.js";
import {
	INTERNAL_SECRETS,
	type MultiTenantServer,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";

let server: MultiTenantServer;
let acme: TenantDocument;
const provisioner = {
	authorization: `Basic ${Buffer.from(`provisioner:${INTERNAL_SECRETS.provisioner}`).toString("base64")}`,
};

beforeAll(async () => {
	server = await startMultiTenantServer();
	acme = await server.addTenant("acme.example.org");
});

afterAll(async () => {
	await server?.close();
});

function event(tenantId: string): AuditOutboxDocument {
	return {
		_id: "evt-1",
		tenantId,
		type: "login.succeeded",
		sub: "acc_1",
		occurredAt: new Date(),
		data: { methods: ["google"] },
		status: "pending",
		attempts: 0,
		nextAttemptAt: new Date(),
	};
}

describe("audit delivery per tenant", () => {
	it("signs each event as its own tenant, always to the one intake", async () => {
		const primaryJwks = { keys: [await generateSigningJwk()] };
		const acmeJwks = { keys: [await generateSigningJwk()] };
		let suspended = false;
		const resolve = createAuditDeliveryResolver({
			primary: {
				config: {
					url: "https://localman.hoandat.com/internal/audit-events",
					clientId: "hoandat-auth",
					clientSecret: "x".repeat(32),
				},
				issuer: "https://auth.hoandat.com",
				jwks: primaryJwks,
			},
			tenantKeys: async (id) =>
				id === acme._id && !suspended
					? { tenant: tenantFromDocument(acme), jwks: acmeJwks }
					: undefined,
		});
		const primary = await resolve(event("primary"));
		expect(primary?.config.url).toBe(
			"https://localman.hoandat.com/internal/audit-events",
		);
		const theirs = await resolve(event(acme._id));
		// Never a URL under the tenant's domain: its owner controls that DNS.
		expect(theirs?.config.url).toBe(
			"https://localman.hoandat.com/internal/audit-events",
		);
		expect(theirs?.config.clientId).toBe("hoandat-auth");
		const token = (await theirs?.sign(event(acme._id))) ?? "";
		expect(decodeJwt(token)).toMatchObject({
			iss: "https://auth.acme.example.org",
			aud: "https://localman.hoandat.com/internal/audit-events",
		});
		expect(decodeProtectedHeader(token).kid).toBe(acmeJwks.keys[0]?.kid);
		suspended = true;
		expect(await resolve(event(acme._id))).toBeUndefined();
	});
});

describe("audit dispatch across tenants", () => {
	it("keeps delivering the primary tenant's events when another tenant's signer fails", async () => {
		const queue = allTenantsAuditQueue(server.db);
		for (let index = 0; index < 6; index += 1) {
			await new AuditOutbox(
				server.db,
				{ id: "ten_broken" },
				createLogger("silent"),
			).record("login.succeeded", `acc_broken_${index}`, {
				methods: ["google"],
			});
		}
		await new AuditOutbox(
			server.db,
			{ id: "primary" },
			createLogger("silent"),
		).record("login.succeeded", "acc_primary", { methods: ["google"] });
		const delivered: string[] = [];
		const dispatcher = new AuditDispatcher({
			outbox: queue,
			logger: createLogger("silent"),
			deliveryFor: async (item) => {
				if (item.tenantId === "ten_broken")
					throw new Error("secret no longer opens");
				return {
					config: {
						url: "https://intake.test/audit",
						clientId: "c",
						clientSecret: "s".repeat(32),
					},
					sign: async () => "signed",
				};
			},
			fetch: async (_url, init) => {
				delivered.push(
					String(new Headers(init?.headers).get("idempotency-key")),
				);
				return new Response(null, { status: 202 });
			},
		});
		const counts = await dispatcher.dispatchDue();
		expect(counts).toEqual({ delivered: 1, failed: 6 });
		expect(delivered).toHaveLength(1);
		const broken = await server.db
			.collection("audit_outbox")
			.find({ tenantId: "ten_broken" })
			.toArray();
		expect(
			broken.every(
				(item) =>
					item.attempts === 1 && item.lastError === "signer unavailable",
			),
		).toBe(true);
	});
});

describe("tenant secrets", () => {
	it("re-seals secrets of an older key so the old key can be removed", async () => {
		const { SecretKeyring } = await import("../tenants/secret-keyring.js");
		const { TenantSecrets } = await import("../tenants/tenant-secrets.js");
		const oldKey = { kid: "old", key: Buffer.alloc(32, 7) };
		const newKey = { kid: "new", key: Buffer.alloc(32, 8) };
		await new TenantSecrets(server.db, new SecretKeyring([oldKey])).put(
			"ten_r",
			"google",
			"{}",
		);
		const rotated = new TenantSecrets(
			server.db,
			new SecretKeyring([newKey, oldKey]),
		);
		expect(await rotated.resealStale()).toBeGreaterThanOrEqual(1);
		expect(await rotated.resealStale()).toBe(0);
		const onlyNew = new TenantSecrets(server.db, new SecretKeyring([newKey]));
		expect(await onlyNew.get("ten_r", "google")).toBe("{}");
	});
});

describe("certificate queue (provisioner)", () => {
	const work = (): Promise<Response> =>
		fetch(`${server.internalOrigin}/internal/certificates/work`, {
			headers: provisioner,
		});
	const report = (tenantId: string, body: object): Promise<Response> =>
		fetch(`${server.internalOrigin}/internal/certificates/${tenantId}`, {
			method: "POST",
			headers: { ...provisioner, "content-type": "application/json" },
			body: JSON.stringify(body),
		});

	it("is closed to the apps", async () => {
		const localman = {
			authorization: `Basic ${Buffer.from(`localman:${INTERNAL_SECRETS.localman}`).toString("base64")}`,
		};
		const response = await fetch(
			`${server.internalOrigin}/internal/certificates/work`,
			{
				headers: localman,
			},
		);
		expect(response.status).toBe(401);
	});

	it("hands out due work with the DNS token sealed for the provisioner only", async () => {
		const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
		await server.secrets.putForProvisioner(acme._id, "cf-secret-token", pem);
		await server.registry.setCertificate(acme._id, {
			status: "pending",
			attempts: 0,
		});
		const body = (await (await work()).json()) as {
			work: Record<string, unknown>[];
		};
		const item = body.work.find((entry) => entry.tenantId === acme._id);
		expect(item).toMatchObject({
			domain: "acme.example.org",
			action: "issue",
			http01: [
				"auth.acme.example.org",
				"chat.acme.example.org",
				"localman.acme.example.org",
				"tunnel.acme.example.org",
			],
			dns01: ["*.localman.acme.example.org", "*.tunnel.acme.example.org"],
		});
		expect(JSON.stringify(body)).not.toContain("cf-secret-token");
		expect(item?.dnsCredential).toHaveProperty("wrappedKey");
		expect(await server.secrets.get(acme._id, "google")).toBeUndefined();
	});

	it("frees the domain of a tenant never activated once its certificates are removed", async () => {
		const stale = await server.addTenant("stale.example.org", "claimed");
		await server.db
			.collection("tenants")
			.updateOne(
				{ _id: stale._id as never },
				{ $set: { claimedAt: new Date(Date.now() - 8 * 24 * 3_600_000) } },
			);
		const expired = await server.registry.expireUnactivated(
			new Date(Date.now() - 7 * 24 * 3_600_000),
		);
		expect(expired.map((tenant) => tenant.domain)).toContain(
			"stale.example.org",
		);
		expect(await server.registry.findById(stale._id)).toMatchObject({
			status: "suspended",
			suspendedReason: "not-activated",
			certificate: { status: "removing" },
		});
		const body = (await (await work()).json()) as {
			work: { tenantId: string; action: string }[];
		};
		expect(body.work).toContainEqual(
			expect.objectContaining({ tenantId: stale._id, action: "remove" }),
		);
		expect((await report(stale._id, { outcome: "removed" })).status).toBe(204);
		expect(
			await server.registry.findByDomain("stale.example.org"),
		).toBeUndefined();
	});

	it("never revives a suspended tenant, and keeps a removal against a late issuance", async () => {
		const gone = await server.addTenant("gone2.example.org", "suspended");
		expect(await server.registry.activateIfClaimed(gone._id)).toBe(false);
		expect((await server.registry.findById(gone._id))?.status).toBe(
			"suspended",
		);
		const late = await server.addTenant("late.example.org", "claimed");
		await server.registry.setCertificate(late._id, {
			status: "removing",
			attempts: 0,
		});
		expect((await report(late._id, { outcome: "issued" })).status).toBe(204);
		expect(
			(await server.registry.findById(late._id))?.certificate?.status,
		).toBe("removing");
	});

	it("deletes an expired tenant's secrets and data with it", async () => {
		const doomed = await server.addTenant("doomed.example.org", "claimed");
		await server.secrets.put(doomed._id, "telegram", "{}");
		await server.db
			.collection("tenants")
			.updateOne(
				{ _id: doomed._id as never },
				{ $set: { claimedAt: new Date(0) } },
			);
		await server.registry.expireUnactivated(new Date(Date.now() - 1_000));
		expect((await report(doomed._id, { outcome: "removed" })).status).toBe(204);
		expect(await server.secrets.has(doomed._id, "telegram")).toBe(false);
		// An active tenant reported removed is never deleted.
		const kept = await server.addTenant("kept2.example.org", "active");
		await server.registry.setCertificate(kept._id, {
			status: "removing",
			attempts: 0,
		});
		await report(kept._id, { outcome: "removed" });
		expect(await server.registry.findById(kept._id)).toBeDefined();
	});

	it("backs off after a failure and records issuance", async () => {
		expect(
			(
				await report(acme._id, {
					outcome: "failed",
					error: "rate\nlimited; $(x)",
				})
			).status,
		).toBe(204);
		const failed = (await server.registry.findById(acme._id))?.certificate;
		expect(failed).toMatchObject({
			status: "failed",
			attempts: 1,
			lastError: "ratelimited x",
		});
		expect(failed?.nextAttemptAt?.getTime()).toBeGreaterThan(
			Date.now() + 3_500_000,
		);
		const body = (await (await work()).json()) as {
			work: { tenantId: string }[];
		};
		expect(body.work.map((entry) => entry.tenantId)).not.toContain(acme._id);
		expect((await report(acme._id, { outcome: "issued" })).status).toBe(204);
		expect(
			(await server.registry.findById(acme._id))?.certificate?.status,
		).toBe("issued");
		expect((await report(acme._id, { outcome: "bogus" })).status).toBe(400);
		expect(certificateBackoffMs(1)).toBe(3_600_000);
		expect(certificateBackoffMs(10)).toBe(24 * 3_600_000);
	});
});

describe("scribe.<domain> certificate queue (ADR 0012)", () => {
	const work = async (
		kinds = "?kinds=hosts,scribe",
	): Promise<Record<string, unknown>[]> => {
		const response = await fetch(
			`${server.internalOrigin}/internal/certificates/work${kinds}`,
			{ headers: provisioner },
		);
		return ((await response.json()) as { work: Record<string, unknown>[] })
			.work;
	};
	const report = (tenantId: string, body: object, query = "?kind=scribe") =>
		fetch(
			`${server.internalOrigin}/internal/certificates/${tenantId}${query}`,
			{
				method: "POST",
				headers: { ...provisioner, "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		);

	it("hands out scribe work of a served tenant, apart from its hosts", async () => {
		const scribe = await server.addTenant("scribe-q.example.org");
		await server.registry.setScribeCertificate(scribe._id, {
			status: "pending",
			attempts: 0,
		});
		const items = (await work()).filter((item) => item.tenantId === scribe._id);
		expect(items).toEqual([
			expect.objectContaining({
				kind: "scribe",
				action: "issue",
				domain: "scribe-q.example.org",
				certName: "scribe.scribe-q.example.org",
				http01: ["scribe.scribe-q.example.org"],
				dns01: [],
			}),
		]);
		// A provisioner that does not ask for Scribe work never sees it.
		const older = await work("");
		expect(older.map((item) => item.tenantId)).not.toContain(scribe._id);
		const suspended = await server.addTenant(
			"scribe-s.example.org",
			"suspended",
		);
		await server.registry.setScribeCertificate(suspended._id, {
			status: "pending",
			attempts: 0,
		});
		const ids = (await work()).map((item) => item.tenantId);
		expect(ids).not.toContain(suspended._id);
	});

	it("records reports in the scribe certificate only, with the same backoff", async () => {
		const tenant = await server.addTenant("scribe-r.example.org");
		await server.registry.setCertificate(tenant._id, {
			status: "issued",
			attempts: 0,
			issuedAt: new Date(),
		});
		expect((await report(tenant._id, { outcome: "issued" })).status).toBe(404);
		await server.registry.setScribeCertificate(tenant._id, {
			status: "pending",
			attempts: 0,
		});
		expect(
			(await report(tenant._id, { outcome: "failed", error: "no A record" }))
				.status,
		).toBe(204);
		let stored = await server.registry.findById(tenant._id);
		expect(stored?.scribeCertificate).toMatchObject({
			status: "failed",
			attempts: 1,
			lastError: "no A record",
		});
		expect(stored?.scribeCertificate?.nextAttemptAt?.getTime()).toBeGreaterThan(
			Date.now() + 3_500_000,
		);
		expect(stored?.certificate?.status).toBe("issued");
		const ids = (await work()).map((item) => item.tenantId);
		expect(ids).not.toContain(tenant._id);
		expect((await report(tenant._id, { outcome: "issued" })).status).toBe(204);
		stored = await server.registry.findById(tenant._id);
		expect(stored?.scribeCertificate?.status).toBe("issued");
		expect((await report(tenant._id, { outcome: "removed" })).status).toBe(204);
		stored = await server.registry.findById(tenant._id);
		expect(stored?.scribeCertificate).toBeUndefined();
		expect(stored?.certificate?.status).toBe("issued");
	});
});
