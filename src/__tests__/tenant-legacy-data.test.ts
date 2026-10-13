import type { Db } from "mongodb";
import type { KoaContextWithOIDC } from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listSessions } from "../account-portal/session-directory.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { MongoAdapter } from "../oidc/mongo-adapter.js";
import { ensureOidcIndexes } from "../oidc/oidc-indexes.js";
import { createRotateAndSlideGrant } from "../oidc/sliding-grants.js";
import { PRIMARY_TENANT_ID } from "../tenants/env-tenant.js";
import {
	TENANT_COLLECTIONS,
	backfillTenantId,
} from "../tenants/tenant-collections.js";
import { openTestDb } from "./helpers/test-accounts.js";
import {
	OTHER_TEST_TENANT,
	PRIMARY_TEST_TENANT,
	primaryAccounts,
} from "./helpers/test-tenant.js";

/**
 * Documents written before tenants existed carry no `tenantId`. Between the
 * deploy and the backfill they must keep working for the primary tenant
 * (and only for it): sessions, refresh tokens, grants and accounts.
 */
let db: Db;
let close: () => Promise<void>;
const future = (): Date => new Date(Date.now() + 3_600_000);

beforeAll(async () => {
	({ db, close } = await openTestDb());
	await ensureOidcIndexes(db);
});

afterAll(async () => {
	await close?.();
});

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

describe("pre-tenant (untagged) data", () => {
	it("works for the primary tenant through upsert, consume and destroy", async () => {
		await insertUntagged("RefreshToken", "rt-old", {
			grantId: "g-old",
			accountId: "acc_old",
		});
		const tokens = new MongoAdapter(db, "RefreshToken", PRIMARY_TEST_TENANT);
		expect(await tokens.find("rt-old")).toMatchObject({ grantId: "g-old" });
		await tokens.consume("rt-old");
		await expect(tokens.consume("rt-old")).rejects.toThrow();
		await tokens.upsert("rt-old", { grantId: "g-old", consumed: 1 }, 60);
		const stored = await db
			.collection<{ _id: string; tenantId?: string }>(
				collectionNameFor("RefreshToken"),
			)
			.findOne({ _id: "rt-old" });
		expect(stored?.tenantId).toBe(PRIMARY_TENANT_ID);
		await tokens.destroy("rt-old");
		expect(await tokens.find("rt-old")).toBeUndefined();
	});

	it("is invisible to any other tenant", async () => {
		await insertUntagged("Session", "s-old", { uid: "u-old", accountId: "a" });
		const theirs = new MongoAdapter(db, "Session", OTHER_TEST_TENANT);
		expect(await theirs.find("s-old")).toBeUndefined();
		expect(await theirs.findByUid("u-old")).toBeUndefined();
		const mine = new MongoAdapter(db, "Session", PRIMARY_TEST_TENANT);
		expect(await mine.findByUid("u-old")).toMatchObject({ accountId: "a" });
		expect(
			await listSessions({ db, tenant: PRIMARY_TEST_TENANT }, "a"),
		).toHaveLength(1);
	});

	it("revokes untagged grant artifacts and slides untagged grants", async () => {
		await insertUntagged("AccessToken", "at-old", { grantId: "g-slide" });
		await new MongoAdapter(
			db,
			"AccessToken",
			PRIMARY_TEST_TENANT,
		).revokeByGrantId("g-slide");
		expect(
			await db.collection(collectionNameFor("AccessToken")).countDocuments({
				grantId: "g-slide",
			}),
		).toBe(0);
		const now = Math.floor(Date.now() / 1000);
		await insertUntagged("Grant", "g-slide", { iat: now, exp: now + 60 });
		const grant = { iat: now, jti: "g-slide", exp: now + 60, clientId: "x" };
		const ctx = { oidc: { entities: { Grant: grant } } };
		await createRotateAndSlideGrant({ db, tenant: PRIMARY_TEST_TENANT })(
			ctx as unknown as KoaContextWithOIDC,
		);
		expect(grant.exp).toBeGreaterThan(now + 60);
	});

	it("keeps untagged accounts usable for the primary tenant", async () => {
		await db.collection("accounts").insertOne({
			_id: "acc_untagged" as never,
			username: "old_timer",
			emailVerifiedBy: null,
			providers: { google: "g-untagged" },
			createdAt: new Date(),
		});
		const accounts = primaryAccounts(db);
		expect(await accounts.findByProvider("google", "g-untagged")).toMatchObject(
			{ _id: "acc_untagged" },
		);
		const write = await accounts.links.setTelegram("acc_untagged", {
			chatId: "42",
		});
		expect(write.applied).toBe(true);
	});

	it("is tagged by the backfill: dry run counts only, a second run finds nothing", async () => {
		const dry = await backfillTenantId(db, PRIMARY_TENANT_ID, { dryRun: true });
		const untagged = dry.reduce((sum, count) => sum + count.untagged, 0);
		expect(untagged).toBeGreaterThan(0);
		expect(dry.every((count) => count.tagged === 0)).toBe(true);
		expect(dry.map((count) => count.collection)).toEqual(TENANT_COLLECTIONS);
		const first = await backfillTenantId(db, PRIMARY_TENANT_ID, {
			dryRun: false,
		});
		expect(first.reduce((sum, count) => sum + count.tagged, 0)).toBe(untagged);
		const second = await backfillTenantId(db, PRIMARY_TENANT_ID, {
			dryRun: false,
		});
		expect(second.every((c) => c.untagged === 0 && c.tagged === 0)).toBe(true);
	});
});
