import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	CONTEXT_RETENTION_MS,
	auditOutboxCollection,
} from "../audit/audit-outbox.js";
import { recordTestLogin } from "./helpers/audit-harness.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

afterEach(async () => {
	await auditOutboxCollection(idp.db).deleteMany({});
});

const LEASE_MS = 30_000;

function outbox() {
	return idp.services.audit;
}

describe("audit outbox ordering, leases and retention", () => {
	it("delivers the oldest due event first, whatever its retry history", async () => {
		const old = await recordTestLogin(idp);
		const fresh = await recordTestLogin(idp);
		const now = new Date();
		// The old event failed often: its next attempt was due long ago but
		// later than the fresh event's; it still goes first.
		await auditOutboxCollection(idp.db).updateOne(
			{ _id: old },
			{
				$set: {
					occurredAt: new Date(now.getTime() - 60_000),
					attempts: 7,
					nextAttemptAt: new Date(now.getTime() - 1_000),
				},
			},
		);
		await auditOutboxCollection(idp.db).updateOne(
			{ _id: fresh },
			{ $set: { nextAttemptAt: new Date(now.getTime() - 5_000) } },
		);
		expect((await outbox().claimDue(now, LEASE_MS))?._id).toBe(old);
		expect((await outbox().claimDue(now, LEASE_MS))?._id).toBe(fresh);
	});

	it("stores an outcome only for the current lease holder", async () => {
		const id = await recordTestLogin(idp);
		const now = new Date();
		const first = await outbox().claimDue(now, LEASE_MS);
		// The first holder stalled past its lease; another dispatcher takes over.
		const later = new Date(now.getTime() + LEASE_MS + 1);
		const second = await outbox().claimDue(later, LEASE_MS);
		if (!first || !second) throw new Error("event not claimed");
		expect(second.leaseId).not.toBe(first.leaseId);

		expect(await outbox().markDelivered(first, later)).toBe(false);
		expect(await outbox().markFailed(first, later, "HTTP 500")).toBe(false);
		await outbox().release(first);
		const held = await auditOutboxCollection(idp.db).findOne({ _id: id });
		expect(held).toMatchObject({ status: "pending", attempts: 0 });
		expect(held?.leaseId).toBe(second.leaseId);

		expect(await outbox().markDelivered(second, later)).toBe(true);
		expect(
			await auditOutboxCollection(idp.db).findOne({ _id: id }),
		).toMatchObject({ status: "delivered" });
	});

	it("drops IP and User-Agent from events undelivered for 30 days", async () => {
		const stale = await recordTestLogin(idp);
		const recent = await recordTestLogin(idp);
		const now = new Date();
		await auditOutboxCollection(idp.db).updateOne(
			{ _id: stale },
			{
				$set: {
					occurredAt: new Date(now.getTime() - CONTEXT_RETENTION_MS - 1),
				},
			},
		);
		expect(await outbox().scrubStaleContext(now)).toBe(1);
		const [scrubbed, kept] = await Promise.all(
			[stale, recent].map((id) =>
				auditOutboxCollection(idp.db).findOne({ _id: id }),
			),
		);
		expect(scrubbed?.context).toBeUndefined();
		expect(scrubbed?.data).toEqual({ methods: ["pwd"] });
		expect(kept?.context).toEqual({ ip: "203.0.113.7", userAgent: "vitest" });
	});
});
