import { randomUUID } from "node:crypto";
import { type Db, MongoClient } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import {
	MongoAdapter,
	OIDC_MODEL_NAMES,
	collectionNameFor,
	ensureOidcIndexes,
} from "./mongo-adapter.js";

let mongo: MongoClient;
let db: Db;

beforeAll(async () => {
	mongo = new MongoClient(inject("mongoUri"));
	await mongo.connect();
	db = mongo.db(`adapter_${randomUUID().slice(0, 8)}`);
	await ensureOidcIndexes(db);
});

afterAll(async () => {
	await db?.dropDatabase();
	await mongo?.close();
});

describe("MongoAdapter", () => {
	it("creates a TTL index on expiresAt for every model", async () => {
		for (const model of OIDC_MODEL_NAMES) {
			const indexes = await db.collection(collectionNameFor(model)).indexes();
			expect(indexes, model).toContainEqual(
				expect.objectContaining({
					key: { expiresAt: 1 },
					expireAfterSeconds: 0,
				}),
			);
		}
	});

	it("stores, finds, consumes and destroys an artifact", async () => {
		const adapter = new MongoAdapter(db, "AuthorizationCode");
		await adapter.upsert("code-1", { jti: "code-1", grantId: "g1" }, 60);
		expect(await adapter.find("code-1")).toEqual({
			jti: "code-1",
			grantId: "g1",
		});

		await adapter.consume("code-1");
		expect(await adapter.find("code-1")).toMatchObject({
			consumed: expect.any(Number),
		});
		// A second consume loses: only one exchange of a code may succeed.
		await expect(adapter.consume("code-1")).rejects.toMatchObject({
			error: "invalid_grant",
		});
		await expect(adapter.consume("missing")).rejects.toMatchObject({
			error: "invalid_grant",
		});

		await adapter.destroy("code-1");
		expect(await adapter.find("code-1")).toBeUndefined();
	});

	it("keeps payload keys containing dots (resource indicators)", async () => {
		const adapter = new MongoAdapter(db, "Grant");
		const resources = { "https://tunnel.hoandat.com": "tunnels:read" };
		await adapter.upsert("grant-1", { jti: "grant-1", resources }, 60);
		expect(await adapter.find("grant-1")).toMatchObject({ resources });
	});

	it("hides artifacts whose expiry passed before the TTL monitor runs", async () => {
		const adapter = new MongoAdapter(db, "AccessToken");
		await adapter.upsert("expired", { jti: "expired" }, 60);
		await db
			.collection(collectionNameFor("AccessToken"))
			.updateOne(
				{ _id: "expired" as never },
				{ $set: { expiresAt: new Date(0) } },
			);
		expect(await adapter.find("expired")).toBeUndefined();
	});

	it("finds device codes by user code and sessions by uid", async () => {
		const devices = new MongoAdapter(db, "DeviceCode");
		await devices.upsert("dc-1", { jti: "dc-1", userCode: "BCDFGHJK" }, 600);
		expect(await devices.findByUserCode("BCDFGHJK")).toMatchObject({
			jti: "dc-1",
		});

		const sessions = new MongoAdapter(db, "Session");
		await sessions.upsert("sess-1", { jti: "sess-1", uid: "uid-1" }, 600);
		expect(await sessions.findByUid("uid-1")).toMatchObject({ jti: "sess-1" });
		// A regenerated id stored before the old one is destroyed must not fail.
		await sessions.upsert("sess-2", { jti: "sess-2", uid: "uid-1" }, 1200);
		expect(await sessions.findByUid("uid-1")).toMatchObject({ jti: "sess-2" });
	});

	it("revokes every artifact of a grant, and only that grant", async () => {
		const tokens = new MongoAdapter(db, "RefreshToken");
		await tokens.upsert("rt-1", { jti: "rt-1", grantId: "g-revoke" }, 600);
		await tokens.upsert("rt-2", { jti: "rt-2", grantId: "g-revoke" }, 600);
		await tokens.upsert("rt-3", { jti: "rt-3", grantId: "g-keep" }, 600);

		await tokens.revokeByGrantId("g-revoke");
		expect(await tokens.find("rt-1")).toBeUndefined();
		expect(await tokens.find("rt-2")).toBeUndefined();
		expect(await tokens.find("rt-3")).toMatchObject({ jti: "rt-3" });
	});

	it("stores clients without expiry", async () => {
		const clients = new MongoAdapter(db, "Client");
		await clients.upsert("client-1", { client_id: "client-1" });
		const stored = await db
			.collection(collectionNameFor("Client"))
			.findOne({ _id: "client-1" as never });
		expect(stored?.expiresAt).toBeUndefined();
		expect(await clients.find("client-1")).toEqual({ client_id: "client-1" });
	});
});
