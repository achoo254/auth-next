import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	type AuditDispatcher,
	MAX_RETRY_MS,
	retryDelayMs,
} from "../audit/audit-dispatcher.js";
import { auditEventUri } from "../audit/audit-events.js";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import {
	SET_LIFETIME_SECONDS,
	SET_TYPE,
} from "../audit/security-event-token.js";
import {
	AUDIT_CLIENT_ID,
	AUDIT_CLIENT_SECRET,
	AuditReceiver,
	deadUrl,
	recordTestLogin,
	testDispatcher,
} from "./helpers/audit-harness.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

let idp: TestIdp;
let receiver: AuditReceiver;
/** Shifts the dispatcher's clock, so backoff can elapse instantly. */
let offsetMs = 0;
const now = (): Date => new Date(Date.now() + offsetMs);

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
	receiver.status = 202;
	receiver.hang = false;
	offsetMs = 0;
	await auditOutboxCollection(idp.db).deleteMany({});
});

function dispatcher(url = receiver.url): AuditDispatcher {
	return testDispatcher(idp, url, { now });
}

function stored(id: string) {
	return auditOutboxCollection(idp.db).findOne({ _id: id });
}

/** `at` lies `delayMs` after the dispatcher's now (allowing for test runtime). */
function expectDelay(at: Date | undefined, delayMs: number): void {
	const delta = (at?.getTime() ?? 0) - now().getTime();
	expect(delta).toBeGreaterThan(delayMs - 1_000);
	expect(delta).toBeLessThanOrEqual(delayMs);
}

function recordLogin(): Promise<string> {
	return recordTestLogin(idp);
}

describe("audit outbox", () => {
	it("stores an event as pending, with no secret in it", async () => {
		const id = await recordLogin();
		expect(await stored(id)).toMatchObject({
			type: "login.succeeded",
			sub: "acc_audit",
			data: { methods: ["pwd"] },
			context: { ip: "203.0.113.7", userAgent: "vitest" },
			status: "pending",
			attempts: 0,
		});
	});

	it("delivers a SET that verifies against the published JWKS", async () => {
		const id = await recordLogin();
		expect(await dispatcher().dispatchDue()).toEqual({
			delivered: 1,
			failed: 0,
		});
		expect(await stored(id)).toMatchObject({ status: "delivered" });

		const [request] = receiver.received;
		if (!request) throw new Error("nothing received");
		const basic = Buffer.from(
			`${AUDIT_CLIENT_ID}:${AUDIT_CLIENT_SECRET}`,
		).toString("base64");
		expect(request.headers).toMatchObject({
			authorization: `Basic ${basic}`,
			"content-type": `application/${SET_TYPE}`,
			"idempotency-key": id,
		});
		const jwks = createRemoteJWKSet(new URL(`${idp.issuer}/jwks`));
		const { payload, protectedHeader } = await jwtVerify(request.body, jwks, {
			issuer: idp.issuer,
			audience: receiver.url,
			algorithms: ["ES256"],
			typ: SET_TYPE,
		});
		expect(protectedHeader.kid).toBe(idp.jwks.keys[0]?.kid);
		expect(payload).toMatchObject({
			jti: id,
			sub: "acc_audit",
			events: {
				[auditEventUri("login.succeeded")]: {
					methods: ["pwd"],
					ip: "203.0.113.7",
					user_agent: "vitest",
				},
			},
		});
		expect(Number(payload.exp) - Number(payload.iat)).toBe(
			SET_LIFETIME_SECONDS,
		);
		expect(typeof payload.toe).toBe("number");
	});

	it("retries a 5xx with backoff and the same idempotency key", async () => {
		const id = await recordLogin();
		receiver.status = 503;
		const sender = dispatcher();
		expect(await sender.dispatchDue()).toEqual({ delivered: 0, failed: 1 });
		const failed = await stored(id);
		expect(failed).toMatchObject({
			status: "pending",
			attempts: 1,
			lastError: "HTTP 503",
		});
		expectDelay(failed?.nextAttemptAt, 5_000);

		// Not due yet: nothing is sent.
		expect(await sender.dispatchDue()).toEqual({ delivered: 0, failed: 0 });
		receiver.status = 202;
		offsetMs += 5_000;
		expect(await sender.dispatchDue()).toEqual({ delivered: 1, failed: 0 });
		expect(await stored(id)).toMatchObject({ status: "delivered" });
		expect(
			receiver.received.map((request) => request.headers["idempotency-key"]),
		).toEqual([id, id]);
	});

	it("keeps events while Localman is unreachable", async () => {
		const id = await recordLogin();
		const sender = dispatcher(await deadUrl());
		await sender.dispatchDue();
		offsetMs += 5_000;
		await sender.dispatchDue();
		const kept = await stored(id);
		expect(kept).toMatchObject({
			status: "pending",
			attempts: 2,
			lastError: "ECONNREFUSED",
		});
		expectDelay(kept?.nextAttemptAt, 10_000);
	});

	it("caps the backoff", () => {
		expect(retryDelayMs(1)).toBe(5_000);
		expect(retryDelayMs(3)).toBe(20_000);
		expect(retryDelayMs(40)).toBe(MAX_RETRY_MS);
	});

	it("never sends one event twice from concurrent polls", async () => {
		const ids = await Promise.all([recordLogin(), recordLogin()]);
		const sender = dispatcher();
		await Promise.all([sender.dispatchDue(), sender.dispatchDue()]);
		const keys = receiver.received.map((r) => r.headers["idempotency-key"]);
		expect(keys.sort()).toEqual([...ids].sort());
	});
});
