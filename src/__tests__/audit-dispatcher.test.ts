import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	AuditReceiver,
	recordTestLogin,
	testDispatcher,
} from "./helpers/audit-harness.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;
let receiver: AuditReceiver;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
	receiver = new AuditReceiver();
	await receiver.start();
});

afterAll(async () => {
	await receiver?.close();
	await idp?.close();
});

afterEach(async () => {
	receiver.received.length = 0;
	receiver.hang = false;
	await auditOutboxCollection(idp.db).deleteMany({});
});

function stored(id: string) {
	return auditOutboxCollection(idp.db).findOne({ _id: id });
}

function recordLogin(): Promise<string> {
	return recordTestLogin(idp);
}

function dispatcher(url = receiver.url, timeoutMs = 2_000) {
	return testDispatcher(idp, url, { timeoutMs });
}

describe("audit dispatcher lifecycle", () => {
	it("delivers in the background and stops cleanly", async () => {
		const sender = dispatcher();
		sender.start();
		const id = await recordLogin();
		await expect
			.poll(async () => (await stored(id))?.status, { timeout: 5_000 })
			.toBe("delivered");
		await sender.stop();
		const later = await recordLogin();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect((await stored(later))?.status).toBe("pending");
	});

	it("hands an attempt in flight back on stop", async () => {
		receiver.hang = true;
		const id = await recordLogin();
		const sender = dispatcher(receiver.url, 30_000);
		sender.start();
		await expect.poll(() => receiver.received.length).toBe(1);
		await sender.stop();
		const released = await stored(id);
		expect(released).toMatchObject({ status: "pending", attempts: 0 });
		expect(released?.leaseUntil).toBeUndefined();
	});
});
