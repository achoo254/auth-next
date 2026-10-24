import { describe, expect, it } from "vitest";
import {
	PURGE_RETENTION_MS,
	purgeRefusal,
} from "../tenants/purge-eligibility.js";

const NOW = Date.UTC(2026, 9, 24);
const DAY = 24 * 60 * 60 * 1000;

describe("which tenants purge-tenant deletes", () => {
	it("refuses a domain that is not a tenant, even with --any-status", () => {
		expect(purgeRefusal("nope.example", undefined, NOW, true)).toMatch(
			/not a tenant/,
		);
	});

	it("deletes a tenant self-hosted for the retention window", () => {
		const enrolledAt = new Date(NOW - PURGE_RETENTION_MS);
		expect(
			purgeRefusal(
				"moved.example",
				{ status: "self_hosted", enrolledAt },
				NOW,
				false,
			),
		).toBeUndefined();
	});

	it("refuses one self-hosted for less than 14 days", () => {
		const enrolledAt = new Date(NOW - 5 * DAY);
		expect(
			purgeRefusal(
				"moved.example",
				{ status: "self_hosted", enrolledAt },
				NOW,
				false,
			),
		).toMatch(/9 day\(s\) left/);
	});

	it("refuses an active tenant without --any-status", () => {
		expect(
			purgeRefusal("live.example", { status: "active" }, NOW, false),
		).toMatch(/not a tenant that moved/);
	});

	it("deletes any tenant, whatever its status or age, with --any-status", () => {
		expect(
			purgeRefusal("live.example", { status: "active" }, NOW, true),
		).toBeUndefined();
		expect(
			purgeRefusal(
				"moved.example",
				{ status: "self_hosted", enrolledAt: new Date(NOW - DAY) },
				NOW,
				true,
			),
		).toBeUndefined();
	});
});
