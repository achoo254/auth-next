import { MongoServerError } from "mongodb";
import { describe, expect, it } from "vitest";
import { inTenant, upsertInTenant } from "./tenant-data.js";

function duplicateKey(): MongoServerError {
	return new MongoServerError({ code: 11000, errmsg: "E11000 duplicate key" });
}

describe("inTenant", () => {
	it("matches untagged documents only for the tenant that owns them", () => {
		expect(inTenant({ id: "primary", ownsUntaggedData: true })).toEqual({
			tenantId: { $in: ["primary", null] },
		});
		expect(inTenant({ id: "ten_x", ownsUntaggedData: false })).toEqual({
			tenantId: "ten_x",
		});
	});
});

describe("upsertInTenant", () => {
	it("retries a racing insert of the same id as a plain write", async () => {
		const writes: string[] = [];
		await upsertInTenant(
			async () => {
				throw duplicateKey();
			},
			async () => {
				writes.push("existing");
				return { matchedCount: 1 };
			},
		);
		expect(writes).toEqual(["existing"]);
	});

	it("keeps the error when the id belongs to another tenant", async () => {
		await expect(
			upsertInTenant(
				async () => {
					throw duplicateKey();
				},
				async () => ({ matchedCount: 0 }),
			),
		).rejects.toThrow(/duplicate key/);
	});

	it("never retries other errors", async () => {
		let retried = false;
		await expect(
			upsertInTenant(
				async () => {
					throw new Error("network");
				},
				async () => {
					retried = true;
					return { matchedCount: 1 };
				},
			),
		).rejects.toThrow("network");
		expect(retried).toBe(false);
	});
});
