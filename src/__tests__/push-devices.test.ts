import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PUSH_DEVICES_COLLECTION,
	PushDevices,
	ensurePushDeviceIndexes,
	slidePushDevices,
} from "../push/push-devices.js";
import { openTestDb } from "./helpers/test-accounts.js";

let test: Awaited<ReturnType<typeof openTestDb>>;

beforeAll(async () => {
	test = await openTestDb();
	await ensurePushDeviceIndexes(test.db);
});

afterAll(async () => {
	await test?.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;

function device(token: string, grantId: string, accountId = "acc_1") {
	return {
		accountId,
		grantId,
		token,
		environment: "production" as const,
		locale: "vi" as const,
		expiresAt: new Date(Date.now() + DAY_MS),
	};
}

describe("PushDevices", () => {
	it("keeps each tenant's devices apart, even for the same token", async () => {
		const primary = new PushDevices(test.db, { id: "primary" });
		const other = new PushDevices(test.db, { id: "tenant-other" });
		await primary.register(device("aa".repeat(32), "g1"));
		await other.register(device("aa".repeat(32), "g1"));
		expect(await primary.listFor("acc_1")).toHaveLength(1);
		expect(await other.removeGrants(["g1"])).toBe(1);
		expect(await primary.listFor("acc_1")).toHaveLength(1);
		expect(
			await test.db
				.collection(PUSH_DEVICES_COLLECTION)
				.countDocuments({ tenantId: "tenant-other" }),
		).toBe(0);
	});

	it("moves a token registered again and keeps one token per grant", async () => {
		const devices = new PushDevices(test.db, { id: "t-move" });
		await devices.register(device("bb".repeat(32), "g-old", "acc_a"));
		// The phone signed in as someone else: the token follows.
		await devices.register(device("bb".repeat(32), "g-new", "acc_b"));
		expect(await devices.listFor("acc_a")).toEqual([]);
		expect(await devices.listFor("acc_b")).toHaveLength(1);
		// APNs gave the phone a new token: the old one goes.
		await devices.register(device("cc".repeat(32), "g-new", "acc_b"));
		const tokens = (await devices.listFor("acc_b")).map((d) => d.token);
		expect(tokens).toEqual(["cc".repeat(32)]);
		expect(await devices.listFor("acc_b", "g-new")).toEqual([]);
	});

	it("forgets an unregistered token unless it was registered again since", async () => {
		const devices = new PushDevices(test.db, { id: "t-410" });
		await devices.register(device("dd".repeat(32), "g1", "acc_c"));
		await devices.removeToken("dd".repeat(32), new Date(Date.now() - DAY_MS));
		expect(await devices.listFor("acc_c")).toHaveLength(1);
		await devices.removeToken("dd".repeat(32), new Date(Date.now() + 1000));
		expect(await devices.listFor("acc_c")).toEqual([]);
	});

	it("slides with its grant and expires by TTL", async () => {
		const tenant = { id: "t-slide" };
		const devices = new PushDevices(test.db, tenant);
		await devices.register(device("ee".repeat(32), "g-slide", "acc_d"));
		const later = new Date(Date.now() + 30 * DAY_MS);
		await slidePushDevices({ db: test.db, tenant }, "g-slide", later);
		const [stored] = await devices.listFor("acc_d");
		expect(stored?.expiresAt.getTime()).toBe(later.getTime());
		const indexes = await test.db.collection(PUSH_DEVICES_COLLECTION).indexes();
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: { expiresAt: 1 },
					expireAfterSeconds: 0,
				}),
				expect.objectContaining({
					key: { tenantId: 1, token: 1 },
					unique: true,
				}),
			]),
		);
		// An expired row is not listed even before the TTL monitor runs.
		await test.db
			.collection(PUSH_DEVICES_COLLECTION)
			.updateOne({ grantId: "g-slide" }, { $set: { expiresAt: new Date(0) } });
		expect(await devices.listFor("acc_d")).toEqual([]);
	});
});
