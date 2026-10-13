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
	return { tenant: tenantFromDocument(document) } as unknown as TenantRuntime;
}

const primary = { tenant: PRIMARY_TEST_TENANT } as unknown as TenantRuntime;

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

	it("remembers unknown hosts for a while instead of querying each time", async () => {
		let now = 0;
		const runtimes = new RuntimeRegistry({
			primary,
			primaryHosts: [],
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

function resolverFor(records: {
	readonly txt?: Record<string, string>;
	readonly a?: Record<string, string[]>;
	readonly wildcardA?: Record<string, string[]>;
}): OwnershipResolver {
	return {
		resolveTxt: async (name) => {
			const value = records.txt?.[name];
			if (value === undefined) throw new Error("ENODATA");
			return [[value]];
		},
		resolve4: async (name) => {
			const exact = records.a?.[name];
			if (exact) return exact;
			const parent = name.split(".").slice(1).join(".");
			const wildcard = records.wildcardA?.[parent];
			if (wildcard) return wildcard;
			throw new Error("ENOTFOUND");
		},
	};
}

describe("ownership re-check", () => {
	const ip = "203.0.113.65";
	function pointingHere(domain: string, txt: string) {
		return {
			txt: { [claimTxtName(domain)]: txt },
			a: {
				[`auth.${domain}`]: [ip],
				[`localman.${domain}`]: [ip],
				[`tunnel.${domain}`]: [ip],
			},
			wildcardA: { [`localman.${domain}`]: [ip], [`tunnel.${domain}`]: [ip] },
		};
	}

	it("keeps a domain that still holds, suspends one that changed hands", async () => {
		const kept = await addTenant("kept.example.org", {
			claimTxt: "kept-proof",
		});
		const lost = await addTenant("lost.example.org", {
			claimTxt: "lost-proof",
		});
		const cdn = await addTenant("cdn.example.org", { claimTxt: "cdn-proof" });
		const records = {
			txt: {
				...pointingHere("kept.example.org", "kept-proof").txt,
				...pointingHere("cdn.example.org", "cdn-proof").txt,
				[claimTxtName("lost.example.org")]: "someone-else",
			},
			a: {
				...pointingHere("kept.example.org", "kept-proof").a,
				...pointingHere("lost.example.org", "lost-proof").a,
				// Proxied through a CDN: the wildcard answers another address.
				...pointingHere("cdn.example.org", "cdn-proof").a,
			},
			wildcardA: {
				...pointingHere("kept.example.org", "kept-proof").wildcardA,
				...pointingHere("lost.example.org", "lost-proof").wildcardA,
				"localman.cdn.example.org": ["104.16.0.1"],
				"tunnel.cdn.example.org": [ip],
			},
		};
		const suspended: string[] = [];
		for (let round = 0; round < SUSPEND_AFTER_FAILURES; round += 1) {
			await checkAllOwnership({
				registry,
				resolver: resolverFor(records),
				serviceIp: ip,
				logger,
				onSuspended: (tenant) => suspended.push(tenant.domain),
			});
		}
		// Tenants of earlier tests have no claim TXT at all and go too.
		expect(suspended).toEqual(
			expect.arrayContaining(["cdn.example.org", "lost.example.org"]),
		);
		expect(suspended).not.toContain("kept.example.org");
		expect((await registry.findById(kept._id))?.status).toBe("claimed");
		expect((await registry.findById(lost._id))?.status).toBe("suspended");
		expect((await registry.findById(cdn._id))?.suspendedReason).toBe(
			"ownership",
		);
	});
});
