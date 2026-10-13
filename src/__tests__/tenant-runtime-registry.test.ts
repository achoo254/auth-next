import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLogger } from "../logger.js";
import type { OwnershipResolver } from "../tenants/ownership-check.js";
import {
	SUSPEND_AFTER_FAILURES,
	checkAllOwnership,
	claimTxtName,
} from "../tenants/ownership-check.js";
import { RuntimeRegistry, authDomainOf } from "../tenants/runtime-registry.js";
import {
	type TenantDocument,
	TenantRegistry,
	ensureTenantRegistryIndexes,
	newTenantId,
} from "../tenants/tenant-registry.js";
import {
	type TenantRuntime,
	tenantFromDocument,
} from "../tenants/tenant-runtime.js";
import { openTestDb } from "./helpers/test-accounts.js";
import { PRIMARY_TEST_TENANT } from "./helpers/test-tenant.js";

const logger = createLogger("silent");
let db: Db;
let close: () => Promise<void>;
let registry: TenantRegistry;

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureTenantRegistryIndexes(db);
	registry = new TenantRegistry(db);
});

afterAll(async () => {
	await close?.();
});

async function addTenant(
	domain: string,
	extra: Partial<TenantDocument> = {},
): Promise<TenantDocument> {
	const document: TenantDocument = {
		_id: newTenantId(),
		domain,
		displayName: domain,
		status: "claimed",
		createdAt: new Date(),
		...extra,
	};
	await registry.insert(document);
	return document;
}

/** A stand-in runtime: only identity matters to the registry. */
function fakeRuntime(document: TenantDocument): TenantRuntime {
	return {
		tenant: tenantFromDocument(document),
		version: document.configVersion ?? 0,
	} as unknown as TenantRuntime;
}

const primary = {
	tenant: PRIMARY_TEST_TENANT,
	version: 0,
} as unknown as TenantRuntime;

describe("RuntimeRegistry", () => {
	it("maps only auth.<domain> to a tenant domain", () => {
		expect(authDomainOf("auth.acme.org")).toBe("acme.org");
		expect(authDomainOf("AUTH.Acme.org:443")).toBe("acme.org");
		expect(authDomainOf("localman.acme.org")).toBeUndefined();
		expect(authDomainOf("auth.com")).toBeUndefined();
	});

	it("builds a tenant once for concurrent requests and keeps it", async () => {
		const document = await addTenant("once.example.org");
		let builds = 0;
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: ["auth.hoandat.com"],
			primaryDomain: "hoandat.com",
			registry,
			maxActive: 5,
			logger,
			build: async (doc) => {
				builds += 1;
				await new Promise((resolve) => setTimeout(resolve, 20));
				return fakeRuntime(doc);
			},
		});
		const found = await Promise.all(
			Array.from({ length: 10 }, () =>
				runtimes.lookup("auth.once.example.org"),
			),
		);
		expect(builds).toBe(1);
		expect(found.every((result) => result.kind === "found")).toBe(true);
		await runtimes.lookup("auth.once.example.org");
		expect(builds).toBe(1);
		expect(await runtimes.lookup("auth.hoandat.com")).toEqual({
			kind: "found",
			runtime: primary,
		});
		runtimes.dispose(document._id);
		await runtimes.lookup("auth.once.example.org");
		expect(builds).toBe(2);
	});

	it("refuses a new tenant beyond TENANT_MAX_ACTIVE without touching others", async () => {
		await addTenant("first.example.org");
		await addTenant("second.example.org");
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: [],
			primaryDomain: "hoandat.com",
			registry,
			maxActive: 1,
			logger,
			build: async (doc) => fakeRuntime(doc),
		});
		expect((await runtimes.lookup("auth.first.example.org")).kind).toBe(
			"found",
		);
		expect((await runtimes.lookup("auth.second.example.org")).kind).toBe(
			"busy",
		);
		expect((await runtimes.lookup("auth.first.example.org")).kind).toBe(
			"found",
		);
		expect(runtimes.activeCount).toBe(1);
	});

	it("rebuilds a tenant whose settings changed, and drops a build disposed meanwhile", async () => {
		const document = await addTenant("versioned.example.org");
		let builds = 0;
		let release: () => void = () => undefined;
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: [],
			primaryDomain: "hoandat.com",
			registry,
			maxActive: 5,
			logger,
			build: async (doc) => {
				builds += 1;
				if (builds === 3)
					await new Promise<void>((resolve) => {
						release = resolve;
					});
				return fakeRuntime(doc);
			},
		});
		const host = "auth.versioned.example.org";
		const first = await runtimes.lookup(host);
		await registry.update(document._id, { displayName: "Renamed" });
		const second = await runtimes.lookup(host);
		expect(builds).toBe(2);
		expect(second).not.toEqual(first);
		await registry.update(document._id, { displayName: "Again" });
		const pending = runtimes.lookup(host);
		await new Promise((resolve) => setTimeout(resolve, 10));
		runtimes.dispose(document._id);
		release();
		await pending;
		await runtimes.lookup(host);
		expect(builds).toBe(4);
	});

	it("never serves a registry tenant at, above or under the primary domain", async () => {
		await addTenant("x.hoandat.com");
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: ["auth.hoandat.com"],
			primaryDomain: "hoandat.com",
			registry,
			maxActive: 5,
			logger,
			build: async (doc) => fakeRuntime(doc),
		});
		expect((await runtimes.lookup("auth.x.hoandat.com")).kind).toBe("unknown");
		expect(await runtimes.lookup("AUTH.hoandat.com.")).toEqual({
			kind: "found",
			runtime: primary,
		});
	});

	it("remembers unknown hosts for a while instead of querying each time", async () => {
		let now = 0;
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: [],
			primaryDomain: "hoandat.com",
			registry,
			maxActive: 5,
			logger,
			now: () => now,
			build: async (doc) => fakeRuntime(doc),
		});
		expect((await runtimes.lookup("auth.later.example.org")).kind).toBe(
			"unknown",
		);
		await addTenant("later.example.org");
		expect((await runtimes.lookup("auth.later.example.org")).kind).toBe(
			"unknown",
		);
		now += 61_000;
		expect((await runtimes.lookup("auth.later.example.org")).kind).toBe(
			"found",
		);
	});
});

describe("ownership re-check, transient DNS faults", () => {
	it("neither counts resolver errors nor suspends everyone at once", async () => {
		const isolated = await openTestDb();
		const local = new TenantRegistry(isolated.db);
		await ensureTenantRegistryIndexes(isolated.db);
		for (const domain of ["one.example.org", "two.example.org"]) {
			await local.insert({
				_id: newTenantId(),
				domain,
				displayName: domain,
				status: "active",
				claimTxt: "proof",
				createdAt: new Date(),
			});
		}
		const failing = (code: string): OwnershipResolver => ({
			resolveTxt: async () => {
				throw Object.assign(new Error(code), { code });
			},
			resolve4: async () => {
				throw Object.assign(new Error(code), { code });
			},
		});
		const run = (resolver: OwnershipResolver) =>
			checkAllOwnership({
				registry: local,
				resolver,
				serviceIp: "203.0.113.65",
				logger,
				onSuspended: () => undefined,
			});
		for (let round = 0; round < 4; round += 1) {
			expect((await run(failing("ETIMEOUT"))).suspended).toBe(0);
			expect((await run(failing("ENOTFOUND"))).suspended).toBe(0);
		}
		const statuses = await Promise.all(
			["one.example.org", "two.example.org"].map(
				async (domain) => (await local.findByDomain(domain))?.status,
			),
		);
		expect(statuses).toEqual(["active", "active"]);
		await isolated.close();
	});
});

function noRecord(): Error {
	return Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
}

function resolverFor(records: {
	readonly txt?: Record<string, string>;
	readonly a?: Record<string, string[]>;
	readonly wildcardA?: Record<string, string[]>;
}): OwnershipResolver {
	return {
		resolveTxt: async (name) => {
			const value = records.txt?.[name];
			if (value === undefined) throw noRecord();
			return [[value]];
		},
		resolve4: async (name) => {
			const exact = records.a?.[name];
			if (exact) return exact;
			const parent = name.split(".").slice(1).join(".");
			const wildcard = records.wildcardA?.[parent];
			if (wildcard) return wildcard;
			throw noRecord();
		},
	};
}

describe("ownership re-check", () => {
	it("restores a tenant suspended for ownership once its DNS is right again", async () => {
		const isolated = await openTestDb();
		const local = new TenantRegistry(isolated.db);
		const ip = "203.0.113.65";
		const tenant: TenantDocument = {
			_id: newTenantId(),
			domain: "back.example.org",
			displayName: "back",
			status: "suspended",
			suspendedReason: "ownership",
			activatedAt: new Date(),
			claimTxt: "proof",
			createdAt: new Date(),
		};
		await local.insert(tenant);
		const restored: string[] = [];
		await checkAllOwnership({
			registry: local,
			resolver: resolverFor({
				txt: { [claimTxtName("back.example.org")]: "proof" },
				a: pointingHere("back.example.org"),
				wildcardA: {
					"localman.back.example.org": [ip],
					"tunnel.back.example.org": [ip],
				},
			}),
			serviceIp: ip,
			logger,
			onSuspended: () => undefined,
			onRestored: (restoredTenant) => restored.push(restoredTenant.domain),
		});
		expect(restored).toEqual(["back.example.org"]);
		expect(await local.findById(tenant._id)).toMatchObject({
			status: "active",
		});
		expect((await local.findById(tenant._id))?.suspendedReason).toBeUndefined();
		await isolated.close();
	});

	const ip = "203.0.113.65";
	const pointingHere = (domain: string) => ({
		[`auth.${domain}`]: [ip],
		[`localman.${domain}`]: [ip],
		[`tunnel.${domain}`]: [ip],
	});

	it("keeps a domain that still holds, suspends one that changed hands", async () => {
		const isolated = await openTestDb();
		const local = new TenantRegistry(isolated.db);
		const add = async (domain: string, claimTxt: string) => {
			const document: TenantDocument = {
				_id: newTenantId(),
				domain,
				displayName: domain,
				status: "active",
				claimTxt,
				createdAt: new Date(),
			};
			await local.insert(document);
			return document;
		};
		const kept = await add("kept.example.org", "kept-proof");
		const lost = await add("lost.example.org", "lost-proof");
		const cdn = await add("cdn.example.org", "cdn-proof");
		const records = {
			txt: {
				[claimTxtName("kept.example.org")]: "kept-proof",
				[claimTxtName("cdn.example.org")]: "cdn-proof",
				[claimTxtName("lost.example.org")]: "someone-else",
			},
			a: {
				...pointingHere("kept.example.org"),
				...pointingHere("lost.example.org"),
				...pointingHere("cdn.example.org"),
			},
			wildcardA: {
				"localman.kept.example.org": [ip],
				"tunnel.kept.example.org": [ip],
				// Proxied through a CDN: the wildcard answers another address.
				"localman.cdn.example.org": ["104.16.0.1"],
				"tunnel.cdn.example.org": [ip],
			},
		};
		const suspended: string[] = [];
		for (let round = 0; round < SUSPEND_AFTER_FAILURES; round += 1) {
			await checkAllOwnership({
				registry: local,
				resolver: resolverFor(records),
				serviceIp: ip,
				logger,
				onSuspended: (tenant) => suspended.push(tenant.domain),
			});
			// Six hours pass: every tenant is due again.
			await isolated.db
				.collection("tenants")
				.updateMany({}, { $set: { ownershipCheckedAt: new Date(0) } });
		}
		expect(suspended.sort()).toEqual(["cdn.example.org", "lost.example.org"]);
		expect((await local.findById(kept._id))?.status).toBe("active");
		expect((await local.findById(lost._id))?.status).toBe("suspended");
		expect((await local.findById(cdn._id))?.suspendedReason).toBe("ownership");
		await isolated.close();
	});
});
