import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AccountRepository } from "../accounts/account-repository.js";
import { accountsCollection } from "../accounts/user-model.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { createLogger } from "../logger.js";
import { clientUsageCollection } from "../usage/client-usage-model.js";
import {
	GROWTH_NUMBERS_PATH,
	createGrowthNumbersRouter,
} from "../usage/growth-numbers-router.js";
import { growthNumbers } from "../usage/growth-numbers.js";
import { openTestDb } from "./helpers/test-accounts.js";

const TENANT = { id: "t-numbers-a" };
const OTHER = { id: "t-numbers-b" };
/** Saturday 31 October 2026, 15:00 in Saigon. */
const NOW = new Date("2026-10-31T08:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

let db: Db;
let close: () => Promise<void>;

async function account(
	tenant: { id: string },
	name: string,
	createdAt: Date,
	extra: { reviewLogin?: true } = {},
): Promise<string> {
	const repository = new AccountRepository(
		db,
		tenant,
		new AuditOutbox(db, tenant, createLogger("silent")),
	);
	const created = await repository.create({
		username: name,
		emailVerifiedBy: null,
		providers: { github: `gh-${name}` },
	});
	await accountsCollection(db).updateOne(
		{ _id: created._id },
		{ $set: { createdAt, ...extra } },
	);
	return created._id;
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
	const regular = await account(TENANT, "regular_one", daysAgo(30));
	const fresh = await account(TENANT, "fresh_one", daysAgo(0.5));
	await account(TENANT, "week_old", daysAgo(5));
	const reviewer = await account(TENANT, "app_reviewer", daysAgo(1), {
		reviewLogin: true,
	});
	const foreign = await account(OTHER, "elsewhere", daysAgo(1));
	const use = (
		sub: string,
		clientId: string,
		at: Date,
		tenantId = TENANT.id,
	) => ({
		tenantId,
		sub,
		clientId,
		at,
		kind: "sso" as const,
	});
	await clientUsageCollection(db).insertMany([
		// Three different days in the window: a regular user.
		use(regular, "tuvi-web", daysAgo(1)),
		use(regular, "miu-web", daysAgo(4)),
		use(regular, "tuvi-web", daysAgo(9)),
		// Twice the same day, and the IdP's own pages: active, not regular.
		use(fresh, "clip-web", daysAgo(0.2)),
		use(fresh, "clip-web", daysAgo(0.1)),
		use(fresh, "hoandat-account", daysAgo(3)),
		use(fresh, "hoandat-account", daysAgo(6)),
		// The reviewer and another tenant never count.
		use(reviewer, "tuvi-web", daysAgo(1)),
		use(reviewer, "tuvi-web", daysAgo(2)),
		use(reviewer, "tuvi-web", daysAgo(3)),
		use(foreign, "tuvi-web", daysAgo(1), OTHER.id),
	]);
});

afterAll(async () => {
	await close();
});

describe("growth numbers", () => {
	it("counts accounts, new ones and regular users of one tenant", async () => {
		expect(await growthNumbers({ db, tenant: TENANT }, NOW)).toEqual({
			accounts: 3,
			newLast24h: 1,
			newLast7d: 2,
			active14d: 2,
			regular14d: 1,
		});
	});

	it("answers programs on this server and nobody behind the proxy", async () => {
		const app = express();
		app.set("trust proxy", "loopback");
		app.use(createGrowthNumbersRouter({ db, tenant: TENANT }));
		const server: Server = await new Promise((resolve) => {
			const s = app.listen(0, "127.0.0.1", () => resolve(s));
		});
		try {
			const { port } = server.address() as AddressInfo;
			const url = `http://127.0.0.1:${port}${GROWTH_NUMBERS_PATH}`;
			const local = await fetch(url);
			expect(local.status).toBe(200);
			expect(await local.json()).toMatchObject({ accounts: 3 });
			const outside = await fetch(url, {
				headers: { "x-forwarded-for": "203.0.113.7" },
			});
			expect(outside.status).toBe(404);
		} finally {
			await new Promise((resolve) => server.close(resolve));
		}
	});
});
