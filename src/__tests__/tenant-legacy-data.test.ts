import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSessions } from "../account-portal/session-directory.js";
import { AccountRepository } from "../accounts/account-repository.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { createLogger } from "../logger.js";
import { MongoAdapter, collectionNameFor } from "../oidc/mongo-adapter.js";
import { ensureOidcIndexes } from "../oidc/oidc-indexes.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import {
	TENANT_COLLECTIONS,
	backfillTenantId,
} from "../tenants/tenant-collections.js";
import {
	UntaggedDataError,
	migrateToTenants,
} from "../tenants/tenant-migration.js";
import { openTestDb } from "./helpers/test-accounts.js";
import {
	OTHER_TEST_TENANT,
	PRIMARY_TEST_TENANT,
	primaryAccounts,
} from "./helpers/test-tenant.js";

/**
 * A database as the single-tenant IdP left it: documents without
 * `tenantId` and global unique indexes. Startup migration tags them as the
 * primary tenant's and drops those indexes, before anything is served.
 */
let db: Db;
let close: () => Promise<void>;
const logger = createLogger("silent");
const future = (): Date => new Date(Date.now() + 3_600_000);

/** As the single-tenant adapter stored it: lookup fields copied out, no tenantId. */
async function insertUntagged(
	model: string,
	id: string,
	payload: Record<string, unknown>,
): Promise<void> {
	const lookups = Object.fromEntries(
		["grantId", "uid", "userCode"].flatMap((key) =>
			payload[key] === undefined ? [] : [[key, payload[key]]],
		),
	);
	await db
		.collection<{ _id: string; [key: string]: unknown }>(
			collectionNameFor(model),
		)
		.insertOne({ _id: id, payload, ...lookups, expiresAt: future() });
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureOidcIndexes(db);
	const accounts = db.collection("accounts");
	// The single-tenant unique indexes, as production still has them.
	await accounts.createIndex({ username: 1 }, { unique: true });
	await accounts.createIndex(
		{ "providers.google": 1 },
		{
			unique: true,
			partialFilterExpression: { "providers.google": { $type: "string" } },
		},
	);
	await db.collection(collectionNameFor("Session")).createIndex({ uid: 1 });
	await accounts.insertOne({
		_id: "acc_untagged" as never,
		username: "old_timer",
		emailVerifiedBy: null,
		providers: { google: "g-untagged" },
		createdAt: new Date(),
	});
	await insertUntagged("Session", "s-old", {
		uid: "u-old",
		accountId: "acc_untagged",
	});
	await insertUntagged("RefreshToken", "rt-old", {
		grantId: "g-old",
		accountId: "acc_untagged",
	});
});

afterAll(async () => {
	await close?.();
});

function otherAccounts(): AccountRepository {
	return new AccountRepository(
		db,
		OTHER_TEST_TENANT,
		new AuditOutbox(db, OTHER_TEST_TENANT, logger),
	);
}

async function indexNames(collection: string): Promise<string[]> {
	return (await db.collection(collection).indexes()).flatMap((index) =>
		index.name ? [index.name] : [],
	);
}

describe("startup migration of pre-tenant data", () => {
	it("leaves untagged documents invisible until they are tagged", async () => {
		expect(
			await primaryAccounts(db).findByProvider("google", "g-untagged"),
		).toBeUndefined();
		const dry = await backfillTenantId(db, PRIMARY_TENANT_ID, { dryRun: true });
		expect(dry.map((count) => count.collection)).toEqual(TENANT_COLLECTIONS);
		expect(dry.reduce((sum, count) => sum + count.untagged, 0)).toBe(3);
		expect(dry.every((count) => count.tagged === 0)).toBe(true);
	});

	it("tags them as the primary tenant's and drops the single-tenant indexes", async () => {
		await migrateToTenants(db, logger);
		expect(
			await primaryAccounts(db).findByProvider("google", "g-untagged"),
		).toMatchObject({ _id: "acc_untagged", tenantId: PRIMARY_TENANT_ID });
		const sessions = new MongoAdapter(db, "Session", PRIMARY_TEST_TENANT);
		expect(await sessions.findByUid("u-old")).toMatchObject({
			accountId: "acc_untagged",
		});
		expect(
			await listSessions({ db, tenant: PRIMARY_TEST_TENANT }, "acc_untagged"),
		).toHaveLength(1);
		const tokens = new MongoAdapter(db, "RefreshToken", PRIMARY_TEST_TENANT);
		await tokens.consume("rt-old");
		await expect(tokens.consume("rt-old")).rejects.toThrow();
		const accounts = await indexNames("accounts");
		expect(accounts).not.toContain("username_1");
		expect(accounts).not.toContain("providers.google_1");
		expect(accounts).toContain("tenant_username");
		expect(await indexNames(collectionNameFor("Session"))).not.toContain(
			"uid_1",
		);
	});

	it("lets another tenant reuse the username and Google account afterwards", async () => {
		const other = new MongoAdapter(db, "Session", OTHER_TEST_TENANT);
		expect(await other.findByUid("u-old")).toBeUndefined();
		await expect(
			otherAccounts().create({
				username: "old_timer",
				emailVerifiedBy: null,
				providers: { google: "g-untagged" },
			}),
		).resolves.toMatchObject({ tenantId: OTHER_TEST_TENANT.id });
	});

	it("never gives untagged documents to the primary tenant once other tenants exist", async () => {
		await db.collection("tenants").insertOne({
			_id: "ten_existing" as never,
			domain: "existing.example.org",
			status: "active",
		});
		await db.collection("accounts").insertOne({
			_id: "acc_stray" as never,
			username: "stray",
			providers: {},
		});
		await expect(migrateToTenants(db, logger)).rejects.toThrow(
			UntaggedDataError,
		);
		expect(
			(await db.collection("accounts").findOne({ _id: "acc_stray" as never }))
				?.tenantId,
		).toBeUndefined();
		await db.collection("accounts").deleteOne({ _id: "acc_stray" as never });
	});

	it("is idempotent", async () => {
		await migrateToTenants(db, logger);
		const left = await backfillTenantId(db, PRIMARY_TENANT_ID, {
			dryRun: true,
		});
		expect(left.every((count) => count.untagged === 0)).toBe(true);
	});
});
