import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import {
	INTERNAL_SECRETS,
	type MultiTenantServer,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";

/** Scribe reads the brand of a host's tenant and may do nothing else. */
let server: MultiTenantServer;
let acme: TenantDocument;

beforeAll(async () => {
	server = await startMultiTenantServer();
	acme = await server.addTenant("acme.example.org");
});

afterAll(async () => {
	await server?.close();
});

const scribe = {
	authorization: `Basic ${Buffer.from(`scribe:${INTERNAL_SECRETS.scribe}`).toString("base64")}`,
};

function internal(path: string, init: RequestInit = {}): Promise<Response> {
	return fetch(`${server.internalOrigin}${path}`, {
		...init,
		headers: scribe,
	});
}

describe("internal API for Scribe", () => {
	it("looks up the primary tenant's brand by the scribe host", async () => {
		const response = await internal(
			"/internal/tenants/lookup?host=scribe.hoandat.com",
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			id: "primary",
			domain: "hoandat.com",
			displayName: expect.any(String),
			issuer: server.env.ISSUER,
		});
	});

	it("needs Scribe's own secret", async () => {
		const response = await fetch(
			`${server.internalOrigin}/internal/tenants/lookup?host=scribe.hoandat.com`,
			{
				headers: {
					authorization: `Basic ${Buffer.from(`scribe:${INTERNAL_SECRETS.localman}`).toString("base64")}`,
				},
			},
		);
		expect(response.status).toBe(401);
	});

	it("refuses every other internal route", async () => {
		for (const [path, method] of [
			["/internal/tenants/primary", "GET"],
			[`/internal/tenants/${acme._id}`, "GET"],
			[`/internal/tenants/${acme._id}/jwks`, "GET"],
			[`/internal/tenants/${acme._id}/openid-configuration`, "GET"],
			["/internal/certificates/work", "GET"],
			[`/internal/certificates/${acme._id}`, "POST"],
		] as const) {
			const response = await internal(path, { method });
			expect(response.status, `${method} ${path}`).toBe(401);
			expect(response.headers.get("www-authenticate")).toBe(
				'Basic realm="internal"',
			);
		}
	});
});
