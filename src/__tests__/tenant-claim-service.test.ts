import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { startClaim, verifyClaim } from "../tenants/claim-service.js";
import type { OwnershipResolver } from "../tenants/ownership-check.js";
import { claimTxtName } from "../tenants/ownership-check.js";
import { SecretKeyring } from "../tenants/secret-keyring.js";
import type { Tenancy } from "../tenants/tenancy.js";
import {
	TenantClaims,
	ensureTenantClaimIndexes,
} from "../tenants/tenant-claims.js";
import {
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../tenants/tenant-registry.js";
import { TenantSecrets } from "../tenants/tenant-secrets.js";
import { openTestDb } from "./helpers/test-accounts.js";

const IP = "203.0.113.65";
const ALICE = { provider: "google" as const, providerId: "g-alice" };
const BOB = { provider: "github" as const, providerId: "gh-bob" };

let db: Db;
let close: () => Promise<void>;
let dns: { txt: Map<string, string>; a: Map<string, string[]> };
let memoryMb: number;

function resolver(): OwnershipResolver {
	const none = (): Error =>
		Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
	return {
		resolveTxt: async (name) => {
			const value = dns.txt.get(name);
			if (value === undefined) throw none();
			return [[value]];
		},
		resolve4: async (name) => {
			const parts = name.split(".");
			const wildcard = `*.${parts.slice(1).join(".")}`;
			const value = dns.a.get(name) ?? dns.a.get(wildcard);
			if (!value) throw none();
			return value;
		},
	};
}

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
	return {
		db,
		registry: new TenantRegistry(db),
		claims: new TenantClaims(db),
		secrets: new TenantSecrets(
			db,
			new SecretKeyring([{ kid: "k", key: Buffer.alloc(32, 1) }]),
		),
		resolver: resolver(),
		serviceIp: IP,
		maxActive: 3,
		minAvailableMemoryMb: 300,
		blockedDomains: ["hoandat.com", "inetdev.io.vn"],
		telegramApiBaseUrl: "https://telegram.test",
		claimUrl: "https://auth.hoandat.com/claim",
		fetch,
		logger: createLogger("silent"),
		availableMemoryMb: () => memoryMb,
		changed: () => undefined,
		...overrides,
	};
}

/** Every record a claim of `domain` needs, pointing at `ip`. */
function pointAt(domain: string, txt: string, ip = IP): void {
	dns.txt.set(claimTxtName(domain), txt);
	for (const host of [
		`auth.${domain}`,
		`localman.${domain}`,
		`tunnel.${domain}`,
		`*.localman.${domain}`,
		`*.tunnel.${domain}`,
	]) {
		dns.a.set(host, [ip]);
	}
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureTenantRegistryIndexes(db);
	await ensureTenantClaimIndexes(db);
});

beforeEach(async () => {
	dns = { txt: new Map(), a: new Map() };
	memoryMb = 2_000;
	await db.collection("tenants").deleteMany({});
	await db.collection("tenant_claims").deleteMany({});
});

afterAll(async () => {
	await close?.();
});

describe("starting a claim", () => {
	it.each([
		["not a domain", "exa mple.com"],
		["a public suffix", "com.vn"],
		["the primary domain", "hoandat.com"],
		["under the primary domain", "x.hoandat.com"],
		["a blocked domain", "tunnel.inetdev.io.vn"],
		["a reserved name", "corp.internal"],
		["an app hostname of another domain", "localman.example.org"],
	])("refuses %s", async (_label, domain) => {
		const result = await startClaim(tenancy(), {
			domain,
			owner: ALICE,
			accountId: "acc_a",
		});
		expect(result).toEqual({ ok: false, error: "invalid-domain" });
	});

	it("refuses a domain at, above or under an existing tenant", async () => {
		const registry = new TenantRegistry(db);
		await registry.insert({
			_id: newTenantId(),
			domain: "acme.org",
			displayName: "acme",
			status: "active",
			createdAt: new Date(),
		});
		for (const domain of ["acme.org", "dev.acme.org"]) {
			expect(
				await startClaim(tenancy(), {
					domain,
					owner: ALICE,
					accountId: "acc_a",
				}),
			).toEqual({ ok: false, error: "taken" });
		}
		await registry.insert({
			_id: newTenantId(),
			domain: "dev.beta.org",
			displayName: "b",
			status: "active",
			createdAt: new Date(),
		});
		expect(
			await startClaim(tenancy(), {
				domain: "beta.org",
				owner: ALICE,
				accountId: "acc_a",
			}),
		).toEqual({ ok: false, error: "taken" });
	});

	it("lets several people claim the same domain until one proves it", async () => {
		const a = await startClaim(tenancy(), {
			domain: "shared.org",
			owner: ALICE,
			accountId: "acc_a",
		});
		const b = await startClaim(tenancy(), {
			domain: "shared.org",
			owner: BOB,
			accountId: "acc_b",
		});
		expect(a.ok && b.ok).toBe(true);
		if (!a.ok || !b.ok) return;
		expect(a.value.txt).not.toBe(b.value.txt);
	});

	it("limits waiting claims, tenants and claims on a short machine", async () => {
		for (const domain of ["one.org", "two.org", "three.org"]) {
			expect(
				(
					await startClaim(tenancy(), {
						domain,
						owner: ALICE,
						accountId: "acc_a",
					})
				).ok,
			).toBe(true);
		}
		expect(
			await startClaim(tenancy(), {
				domain: "four.org",
				owner: ALICE,
				accountId: "acc_a",
			}),
		).toEqual({ ok: false, error: "too-many-pending" });
		memoryMb = 100;
		expect(
			await startClaim(tenancy(), {
				domain: "five.org",
				owner: BOB,
				accountId: "acc_b",
			}),
		).toEqual({ ok: false, error: "capacity" });
		memoryMb = 2_000;
		expect(
			await startClaim(tenancy({ maxActive: 0 }), {
				domain: "six.org",
				owner: BOB,
				accountId: "acc_b",
			}),
		).toEqual({ ok: false, error: "capacity" });
		expect(
			await startClaim(tenancy({ serviceIp: undefined }), {
				domain: "seven.org",
				owner: BOB,
				accountId: "acc_b",
			}),
		).toEqual({ ok: false, error: "unavailable" });
	});
});

describe("verifying a claim", () => {
	it("needs this claim's TXT value and every host pointing here, DNS only", async () => {
		const mine = await startClaim(tenancy(), {
			domain: "acme.org",
			owner: ALICE,
			accountId: "acc_a",
		});
		const theirs = await startClaim(tenancy(), {
			domain: "acme.org",
			owner: BOB,
			accountId: "acc_b",
		});
		if (!mine.ok || !theirs.ok) throw new Error("claims not started");
		expect(await verifyClaim(tenancy(), mine.value._id, "acc_a")).toEqual({
			ok: false,
			error: "dns-txt",
		});
		// The other claimant's TXT does not prove mine.
		pointAt("acme.org", theirs.value.txt);
		expect(await verifyClaim(tenancy(), mine.value._id, "acc_a")).toEqual({
			ok: false,
			error: "dns-txt",
		});
		pointAt("acme.org", mine.value.txt, "104.16.0.1");
		expect(await verifyClaim(tenancy(), mine.value._id, "acc_a")).toEqual({
			ok: false,
			error: "dns-address",
		});
		expect(await verifyClaim(tenancy(), mine.value._id, "acc_b")).toEqual({
			ok: false,
			error: "not-found",
		});
		pointAt("acme.org", mine.value.txt);
		const done = await verifyClaim(tenancy(), mine.value._id, "acc_a");
		expect(done).toMatchObject({
			ok: true,
			value: {
				domain: "acme.org",
				status: "claimed",
				owner: ALICE,
				certificate: { status: "pending" },
			},
		});
		// The rival claim ends; the domain is taken.
		expect(await verifyClaim(tenancy(), theirs.value._id, "acc_b")).toEqual({
			ok: false,
			error: "not-found",
		});
		const audit = await db
			.collection("audit_outbox")
			.findOne({ type: "tenant.claimed" });
		expect(audit).toMatchObject({
			sub: "google:g-alice",
			data: { domain: "acme.org" },
		});
		expect(audit?.tenantId).toBe(done.ok ? done.value._id : "");
	});

	it("does not conclude anything when DNS cannot be asked", async () => {
		const claim = await startClaim(tenancy(), {
			domain: "flaky.org",
			owner: ALICE,
			accountId: "acc_a",
		});
		if (!claim.ok) throw new Error("claim not started");
		const broken: OwnershipResolver = {
			resolveTxt: async () => {
				throw Object.assign(new Error("ETIMEOUT"), { code: "ETIMEOUT" });
			},
			resolve4: async () => [IP],
		};
		expect(
			await verifyClaim(
				tenancy({ resolver: broken }),
				claim.value._id,
				"acc_a",
			),
		).toEqual({ ok: false, error: "dns-unreachable" });
	});

	it("refuses an expired claim", async () => {
		const claim = await startClaim(tenancy(), {
			domain: "late.org",
			owner: ALICE,
			accountId: "acc_a",
		});
		if (!claim.ok) throw new Error("claim not started");
		await db
			.collection("tenant_claims")
			.updateOne(
				{ _id: claim.value._id as never },
				{ $set: { expiresAt: new Date(0) } },
			);
		pointAt("late.org", claim.value.txt);
		expect(await verifyClaim(tenancy(), claim.value._id, "acc_a")).toEqual({
			ok: false,
			error: "not-found",
		});
	});
});
