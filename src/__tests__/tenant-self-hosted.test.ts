import type { Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import { generateSigningJwk } from "../oidc/jwks.js";
import { startClaim, verifyClaim } from "../tenants/claim-service.js";
import {
	SUSPEND_AFTER_FAILURES,
	checkAllOwnership,
} from "../tenants/ownership-check.js";
import {
	type OwnershipResolver,
	claimTxtName,
} from "../tenants/ownership-records.js";
import { SecretKeyring } from "../tenants/secret-keyring.js";
import type { Tenancy } from "../tenants/tenancy.js";
import {
	TenantClaims,
	ensureTenantClaimIndexes,
} from "../tenants/tenant-claims.js";
import {
	type TenantDocument,
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../tenants/tenant-registry.js";
import { TenantSecrets } from "../tenants/tenant-secrets.js";
import { openTestDb } from "./helpers/test-accounts.js";

const gatewayJwks = { keys: [await generateSigningJwk()] };

/*
 * Self-hosted tenants (ADR 0007): proven by TXT only, never served,
 * certified or address-checked here, removed when their TXT goes.
 */

const ALICE = { provider: "google" as const, providerId: "g-alice" };
const DOMAIN = "own.example.org";

let db: Db;
let close: () => Promise<void>;
let txt: Map<string, string>;
let addressLookups: string[];

const resolver: OwnershipResolver = {
	resolveTxt: async (name) => {
		const value = txt.get(name);
		if (value === undefined) {
			throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
		}
		return [[value]];
	},
	resolve4: async (name) => {
		addressLookups.push(name);
		return ["198.51.100.7"];
	},
};

function tenancy(overrides: Partial<Tenancy> = {}): Tenancy {
	return {
		db,
		registry: new TenantRegistry(db),
		claims: new TenantClaims(db),
		secrets: new TenantSecrets(
			db,
			new SecretKeyring([{ kid: "k", key: Buffer.alloc(32, 1) }]),
		),
		resolver,
		selfHostedClaims: true,
		// Nothing here to point DNS at, and no room for another runtime.
		maxActive: 0,
		minAvailableMemoryMb: 300,
		blockedDomains: ["hoandat.com"],
		telegramApiBaseUrl: "https://telegram.test",
		claimUrl: "https://auth.hoandat.com/claim",
		issuer: "https://auth.hoandat.com",
		signingJwks: gatewayJwks,
		fetchChallenge: async () => undefined,
		fetch,
		logger: createLogger("silent"),
		availableMemoryMb: () => 0,
		changed: () => undefined,
		...overrides,
	};
}

const by = {
	owner: ALICE,
	accountId: "acc_a",
	identities: [ALICE],
	hosting: "self" as const,
};

/** Claims DOMAIN self-hosted and proves it; returns the new tenant. */
async function enrolledTenant(): Promise<TenantDocument> {
	const started = await startClaim(tenancy(), { domain: DOMAIN, ...by });
	if (!started.ok) throw new Error(started.error);
	txt.set(claimTxtName(DOMAIN), started.value.txt);
	const verified = await verifyClaim(tenancy(), started.value._id, {
		id: "acc_a",
		identities: [ALICE],
	});
	if (!verified.ok) throw new Error(verified.error);
	return verified.value;
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureTenantRegistryIndexes(db);
	await ensureTenantClaimIndexes(db);
});

beforeEach(async () => {
	txt = new Map();
	addressLookups = [];
	await db.collection("tenants").deleteMany({});
	await db.collection("tenant_claims").deleteMany({});
});

afterAll(async () => {
	await close?.();
});

describe("claiming a domain to host it yourself", () => {
	it("is refused unless SELF_HOSTED_CLAIMS offers it", async () => {
		const result = await startClaim(tenancy({ selfHostedClaims: false }), {
			domain: DOMAIN,
			...by,
		});
		expect(result).toEqual({ ok: false, error: "unavailable" });
	});

	it("needs only the TXT record: no service address, no room, no A lookups", async () => {
		const started = await startClaim(tenancy(), { domain: DOMAIN, ...by });
		if (!started.ok) throw new Error(started.error);
		expect(started.value.hosting).toBe("self");
		const unproven = await verifyClaim(tenancy(), started.value._id, {
			id: "acc_a",
			identities: [ALICE],
		});
		expect(unproven).toEqual({ ok: false, error: "dns-txt" });
		const tenant = await enrolledTenant();
		expect(tenant).toMatchObject({ status: "enrolling", owner: ALICE });
		expect(tenant.certificate).toBeUndefined();
		expect(addressLookups).toEqual([]);
	});

	it("never takes a serving slot, certificate work or a Host lookup", async () => {
		const tenant = await enrolledTenant();
		const registry = new TenantRegistry(db);
		expect(await registry.countServing()).toBe(0);
		expect(await registry.listCertificateWork(new Date())).toEqual([]);
		expect((await registry.findById(tenant._id))?.status).toBe("enrolling");
	});

	it("still counts towards the tenants one account may hold", async () => {
		const registry = new TenantRegistry(db);
		for (const domain of ["one.example.org", "two.example.org"]) {
			await registry.insert({
				_id: newTenantId(),
				domain,
				displayName: domain,
				status: "self_hosted",
				owner: ALICE,
				createdAt: new Date(),
			});
		}
		const result = await startClaim(tenancy(), { domain: DOMAIN, ...by });
		expect(result).toEqual({ ok: false, error: "too-many-tenants" });
	});
});

describe("re-checking a self-hosted tenant", () => {
	const check = () =>
		checkAllOwnership({
			registry: new TenantRegistry(db),
			resolver,
			logger: createLogger("silent"),
			onSuspended: () => {
				throw new Error("a self-hosted tenant is never suspended");
			},
		});

	/** Makes the tenant due for its next check. */
	async function makeDue(id: string): Promise<void> {
		await db
			.collection<TenantDocument>("tenants")
			.updateOne({ _id: id }, { $unset: { ownershipCheckedAt: "" } });
	}

	it("checks the TXT only, and removes the entry once the TXT is gone", async () => {
		const tenant = await enrolledTenant();
		const registry = new TenantRegistry(db);
		expect(await check()).toEqual({ checked: 1, suspended: 0 });
		expect(addressLookups).toEqual([]);
		txt.delete(claimTxtName(DOMAIN));
		for (let round = 1; round <= SUSPEND_AFTER_FAILURES; round += 1) {
			expect(await registry.findById(tenant._id)).toBeDefined();
			await makeDue(tenant._id);
			await check();
		}
		expect(await registry.findById(tenant._id)).toBeUndefined();
		expect(addressLookups).toEqual([]);
	});

	it("expires a tenant whose install never enrolled, freeing the domain", async () => {
		const tenant = await enrolledTenant();
		const registry = new TenantRegistry(db);
		expect(await registry.expireEnrolling(new Date(0))).toEqual([]);
		const expired = await registry.expireEnrolling(new Date(Date.now() + 1));
		expect(expired.map((entry) => entry._id)).toEqual([tenant._id]);
		expect(await registry.findById(tenant._id)).toBeUndefined();
	});
});

describe("moving an active tenant to its owner's servers", () => {
	async function activeTenant(): Promise<TenantDocument> {
		const tenant: TenantDocument = {
			_id: newTenantId(),
			domain: DOMAIN,
			displayName: DOMAIN,
			status: "active",
			owner: ALICE,
			claimTxt: "hoandat-auth-claim=moving",
			createdAt: new Date(),
			claimedAt: new Date(),
			activatedAt: new Date(),
		};
		await new TenantRegistry(db).insert(tenant);
		txt.set(claimTxtName(DOMAIN), tenant.claimTxt ?? "");
		return tenant;
	}

	it("starts only from active, stops serving, and cancels back to active", async () => {
		const tenant = await activeTenant();
		const registry = new TenantRegistry(db);
		expect(await registry.cancelMigration(tenant._id)).toBe(false);
		expect(await registry.startMigration(tenant._id)).toBe(true);
		expect(await registry.startMigration(tenant._id)).toBe(false);
		expect(await registry.countServing()).toBe(0);
		expect(await registry.cancelMigration(tenant._id)).toBe(true);
		expect((await registry.findById(tenant._id))?.status).toBe("active");
	});

	it("is checked by TXT only while moving, and never removed for a missing TXT", async () => {
		const tenant = await activeTenant();
		const registry = new TenantRegistry(db);
		await registry.startMigration(tenant._id);
		txt.delete(claimTxtName(DOMAIN));
		for (let round = 0; round < SUSPEND_AFTER_FAILURES + 1; round += 1) {
			await db
				.collection<TenantDocument>("tenants")
				.updateOne({ _id: tenant._id }, { $unset: { ownershipCheckedAt: "" } });
			await checkAllOwnership({
				registry,
				resolver,
				logger: createLogger("silent"),
				onSuspended: () => {
					throw new Error("a moving tenant is never suspended");
				},
			});
		}
		expect((await registry.findById(tenant._id))?.status).toBe("migrating");
		expect(addressLookups).toEqual([]);
	});

	it("still counts towards the tenants one account may hold", async () => {
		const registry = new TenantRegistry(db);
		const first = await activeTenant();
		await registry.startMigration(first._id);
		await registry.insert({
			_id: newTenantId(),
			domain: "two.example.org",
			displayName: "two",
			status: "active",
			owner: ALICE,
			createdAt: new Date(),
		});
		const result = await startClaim(tenancy(), {
			domain: "three.example.org",
			...by,
		});
		expect(result).toEqual({ ok: false, error: "too-many-tenants" });
	});
});
