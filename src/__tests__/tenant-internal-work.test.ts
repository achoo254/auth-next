import { generateKeyPairSync } from "node:crypto";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	auditIntakeUrl,
	createAuditDeliveryResolver,
} from "../audit/audit-delivery.js";
import type { AuditOutboxDocument } from "../audit/audit-outbox.js";
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
	it("signs each event as its own tenant and sends it to its own Localman", async () => {
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
		expect(theirs?.config.url).toBe(auditIntakeUrl("acme.example.org"));
		expect(theirs?.config.clientId).toBe("hoandat-auth");
		const token = (await theirs?.sign(event(acme._id))) ?? "";
		expect(decodeJwt(token)).toMatchObject({
			iss: "https://auth.acme.example.org",
			aud: "https://localman.acme.example.org/internal/audit-events",
		});
		expect(decodeProtectedHeader(token).kid).toBe(acmeJwks.keys[0]?.kid);
		suspended = true;
		expect(await resolve(event(acme._id))).toBeUndefined();
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
				"localman.acme.example.org",
				"tunnel.acme.example.org",
			],
			dns01: ["*.localman.acme.example.org", "*.tunnel.acme.example.org"],
		});
		expect(JSON.stringify(body)).not.toContain("cf-secret-token");
		expect(item?.dnsCredential).toHaveProperty("wrappedKey");
		expect(await server.secrets.get(acme._id, "google")).toBeUndefined();
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
