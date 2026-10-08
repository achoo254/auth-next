import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	IDENTIFIER_POLICY,
	LoginThrottle,
	type ThrottleSubject,
} from "../accounts/login-throttle.js";
import { ipThrottleKey } from "../http/client-ip.js";
import { openTestDb } from "./helpers/test-accounts.js";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
	({ db, close } = await openTestDb());
});

afterAll(async () => {
	await close?.();
});

function counter(id: string) {
	return db
		.collection<{
			_id: string;
			attempts: number;
			lockedUntil?: Date;
			expiresAt: Date;
		}>("login_throttle")
		.findOne({ _id: id });
}

/** Reserves `count` attempts and fails every one that was granted. */
async function failAttempts(
	throttle: LoginThrottle,
	subject: ThrottleSubject,
	count: number,
): Promise<number> {
	let granted = 0;
	for (let i = 0; i < count; i += 1) {
		const reservation = await throttle.reserve(subject);
		if (!reservation) continue;
		granted += 1;
		await reservation.fail();
	}
	return granted;
}

describe("attempt reservations", () => {
	it("lets only 5 of 25 parallel attempts through, then locks for 15 minutes", async () => {
		const throttle = new LoginThrottle(db, "unit");
		const subject = { identifier: "acc_parallel", ip: "203.0.113.7" };
		const granted = (
			await Promise.all(
				Array.from({ length: 25 }, () => throttle.reserve(subject)),
			)
		).filter((reservation) => reservation !== undefined);
		expect(granted).toHaveLength(5);
		for (const reservation of granted) await reservation.fail();
		// A new instance (as after a restart) reads the lock from MongoDB.
		const restarted = new LoginThrottle(db, "unit");
		expect(await restarted.isLocked(subject)).toBe(true);
		expect(await restarted.reserve(subject)).toBeUndefined();
		const stored = await counter("unit:id:acc_parallel");
		const minutes =
			((stored?.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000;
		expect(minutes).toBeGreaterThan(14);
		expect(minutes).toBeLessThanOrEqual(15);
		await restarted.clear(["acc_parallel"]);
		expect(await restarted.reserve(subject)).toBeDefined();
	});

	it("does not count or extend anything while a key is locked", async () => {
		const throttle = new LoginThrottle(db, "unit-locked");
		const subject = { identifier: "victim", ip: "198.51.100.1" };
		expect(await failAttempts(throttle, subject, 5)).toBe(5);
		const locked = await counter("unit-locked:id:victim");
		for (let i = 0; i < 10; i += 1)
			expect(await throttle.reserve(subject)).toBeUndefined();
		const after = await counter("unit-locked:id:victim");
		expect(after?.attempts).toBe(locked?.attempts);
		expect(after?.lockedUntil?.getTime()).toBe(locked?.lockedUntil?.getTime());
	});

	it("bounds Telegram sends per window without ever extending it", async () => {
		const throttle = new LoginThrottle(db, "unit-telegram", {
			...IDENTIFIER_POLICY,
			maxAttempts: 3,
		});
		const subject = { identifier: "acc_tg", ip: "198.51.100.2" };
		const first = await Promise.all(
			Array.from({ length: 6 }, () => throttle.reserve(subject)),
		);
		expect(
			first.filter((reservation) => reservation !== undefined),
		).toHaveLength(3);
		const window = (
			await counter("unit-telegram:id:acc_tg")
		)?.expiresAt.getTime();
		for (let i = 0; i < 5; i += 1) await throttle.reserve(subject);
		const later = await counter("unit-telegram:id:acc_tg");
		expect(later?.expiresAt.getTime()).toBe(window);
		expect(later?.lockedUntil).toBeUndefined();
	});

	it("a remembered device has its own budget of 5, then counts as a stranger", async () => {
		const throttle = new LoginThrottle(db, "unit-device");
		const stranger = { identifier: "acc_owner", ip: "192.0.2.10" };
		expect(await failAttempts(throttle, stranger, 6)).toBe(5);
		const device = {
			identifier: "acc_owner",
			ip: "192.0.2.20",
			device: "sig-a",
		};
		// The account is locked, yet the remembered browser still gets 5 tries.
		expect(await failAttempts(throttle, device, 7)).toBe(5);
		// Its exemption is gone (for this cookie only): the account lock applies.
		expect(await throttle.reserve(device)).toBeUndefined();
		const otherCookie = { ...device, device: "sig-b" };
		const reservation = await throttle.reserve(otherCookie);
		expect(reservation).toBeDefined();
		await reservation?.succeed();
		expect((await counter("unit-device:dev:sig-a"))?.lockedUntil).toBeDefined();
	});

	it("the IP budget applies to remembered devices too", async () => {
		const throttle = new LoginThrottle(db, "unit-ip", IDENTIFIER_POLICY, {
			...IDENTIFIER_POLICY,
			maxAttempts: 3,
		});
		const device = { identifier: "acc_ip", ip: "192.0.2.30", device: "sig-ip" };
		const granted = await Promise.all(
			Array.from({ length: 4 }, () => throttle.reserve(device)),
		);
		expect(
			granted.filter((reservation) => reservation !== undefined),
		).toHaveLength(3);
	});
});

describe("ipThrottleKey", () => {
	it("keeps IPv4, unwraps IPv4-mapped IPv6 and groups IPv6 by /64", () => {
		expect(ipThrottleKey("203.0.113.9")).toBe("203.0.113.9");
		expect(ipThrottleKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
		expect(ipThrottleKey("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
		expect(ipThrottleKey("2001:db8:1:2:ffff:ffff:ffff:fffe")).toBe(
			"2001:db8:1:2::/64",
		);
		expect(ipThrottleKey("2001:DB8::1")).toBe("2001:db8:0:0::/64");
		expect(ipThrottleKey("fe80::1%en0")).toBe("fe80:0:0:0::/64");
		expect(ipThrottleKey("::1")).toBe("0:0:0:0::/64");
	});
});
