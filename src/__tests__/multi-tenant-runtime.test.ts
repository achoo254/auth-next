import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TenantDocument } from "../tenants/tenant-registry.js";
import {
	INTERNAL_SECRETS,
	type MultiTenantServer,
	fetchAs,
	getAs,
	startMultiTenantServer,
} from "./helpers/multi-tenant-server.js";

/**
 * One IdP process serving the primary tenant and registry tenants, chosen
 * by Host, as production runs it (createServing).
 */
let server: MultiTenantServer;
let acme: TenantDocument;
const primaryHost = (): string => new URL(server.origin).host;

beforeAll(async () => {
	server = await startMultiTenantServer();
	acme = await server.addTenant("acme.example.org");
});

afterAll(async () => {
	await server?.close();
});

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

function basic(role: string, secret: string): Record<string, string> {
	return {
		authorization: `Basic ${Buffer.from(`${role}:${secret}`).toString("base64")}`,
	};
}

describe("multi-tenant runtime", () => {
	it("serves each tenant its own discovery, issuer and keys", async () => {
		const primary = await json(
			await getAs(server, primaryHost(), "/.well-known/openid-configuration"),
		);
		const theirs = await json(
			await getAs(
				server,
				"auth.acme.example.org",
				"/.well-known/openid-configuration",
			),
		);
		expect(primary.issuer).toBe(server.origin);
		expect(theirs.issuer).toBe("https://auth.acme.example.org");
		expect(theirs.token_endpoint).toBe("https://auth.acme.example.org/token");
		const kids = async (host: string): Promise<string[]> => {
			const body = await json(await getAs(server, host, "/jwks"));
			return (body.keys as { kid: string }[]).map((key) => key.kid);
		};
		const primaryKids = await kids(primaryHost());
		const acmeKids = await kids("auth.acme.example.org");
		expect(acmeKids).toHaveLength(2);
		expect(acmeKids.some((kid) => primaryKids.includes(kid))).toBe(false);
		// Stored sealed and reused: the same keys after another lookup.
		expect(await kids("auth.acme.example.org")).toEqual(acmeKids);
	});

	it("shows the tenant's brand and never the primary tenant's providers", async () => {
		const page = await (
			await getAs(server, "auth.acme.example.org", "/apps")
		).text();
		expect(page).toContain("<b>acme</b>");
		expect(page).not.toContain("<b>hoandat</b>");
		expect(page).toContain("https://localman.acme.example.org");
		const runtime = await server.serving.primary;
		expect(runtime.services.upstreams.size).toBe(2);
	});

	it("refuses unknown, unclaimed and suspended hosts", async () => {
		for (const host of [
			"auth.unknown.example.org",
			"localman.acme.example.org",
			"evil.example",
		]) {
			expect(
				(await getAs(server, host, "/.well-known/openid-configuration")).status,
				host,
			).toBe(421);
		}
		const gone = await server.addTenant("gone.example.org", "suspended");
		expect(gone.status).toBe("suspended");
		expect((await getAs(server, "auth.gone.example.org", "/jwks")).status).toBe(
			421,
		);
		expect((await getAs(server, "evil.example", "/healthz")).status).toBe(200);
	});

	it("keeps per-tenant rate limits in one process-wide store", async () => {
		const register = (host: string): Promise<Response> =>
			fetchAs(server.origin, host, "/reg", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "{}",
			});
		// The registration budget is 20 per hour per (tenant, IP).
		for (let index = 0; index < 20; index += 1) {
			await register("auth.acme.example.org");
		}
		expect((await register("auth.acme.example.org")).status).toBe(429);
		expect((await register(primaryHost())).status).not.toBe(429);
		expect((await register("auth.acme.example.org")).status).toBe(429);
	});
});

describe("internal API", () => {
	const localman = basic("localman", INTERNAL_SECRETS.localman);

	it("requires an app's own credentials", async () => {
		const url = `${server.internalOrigin}/internal/tenants/lookup?host=localman.acme.example.org`;
		expect((await fetch(url)).status).toBe(401);
		expect(
			(await fetch(url, { headers: basic("localman", "wrong".repeat(8)) }))
				.status,
		).toBe(401);
		expect(
			(
				await fetch(url, {
					headers: basic("provisioner", INTERNAL_SECRETS.provisioner),
				})
			).status,
		).toBe(401);
		expect((await fetch(url, { headers: localman })).status).toBe(200);
	});

	it("finds the tenant of any app host, without secrets", async () => {
		for (const host of [
			"localman.acme.example.org",
			"mock-1.localman.acme.example.org",
			"tunnel.acme.example.org",
			"x.tunnel.acme.example.org",
			"auth.acme.example.org",
		]) {
			const response = await fetch(
				`${server.internalOrigin}/internal/tenants/lookup?host=${host}`,
				{ headers: localman },
			);
			expect(await response.json(), host).toMatchObject({
				id: acme._id,
				issuer: "https://auth.acme.example.org",
				resources: { tunnel: "https://tunnel.acme.example.org" },
			});
		}
		const owner = { provider: "google" as const, providerId: "g-acme-owner" };
		await server.db
			.collection("tenants")
			.updateOne({ _id: acme._id as never }, { $set: { owner } });
		const ownerAccount = await server.db.collection("accounts").insertOne({
			_id: "acc_acme_owner" as never,
			tenantId: acme._id,
			username: "owner",
			emailVerifiedBy: null,
			providers: { google: owner.providerId },
			createdAt: new Date(),
		});
		const withOwner = await json(
			await fetch(
				`${server.internalOrigin}/internal/tenants/lookup?host=localman.acme.example.org`,
				{ headers: localman },
			),
		);
		expect(withOwner.ownerSubs).toEqual([ownerAccount.insertedId]);
		const primary = await json(
			await fetch(
				`${server.internalOrigin}/internal/tenants/lookup?host=localman.hoandat.com`,
				{ headers: localman },
			),
		);
		expect(primary).toMatchObject({ id: "primary", domain: "hoandat.com" });
		expect(
			(
				await fetch(
					`${server.internalOrigin}/internal/tenants/lookup?host=localman.nope.org`,
					{ headers: localman },
				)
			).status,
		).toBe(404);
	});

	it("serves a tenant's public keys and discovery", async () => {
		const jwks = await json(
			await fetch(
				`${server.internalOrigin}/internal/tenants/${acme._id}/jwks`,
				{ headers: localman },
			),
		);
		const keys = jwks.keys as Record<string, unknown>[];
		expect(keys).toHaveLength(2);
		for (const key of keys) {
			for (const secret of ["d", "p", "q", "dp", "dq", "qi"])
				expect(key).not.toHaveProperty(secret);
		}
		const discovery = await json(
			await fetch(
				`${server.internalOrigin}/internal/tenants/${acme._id}/openid-configuration`,
				{ headers: localman },
			),
		);
		expect(discovery.issuer).toBe("https://auth.acme.example.org");
	});

	it("is not served by the public listener", async () => {
		const response = await getAs(
			server,
			primaryHost(),
			"/internal/tenants/lookup?host=localman.hoandat.com",
			localman,
		);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('hoandat.com"');
	});
});
