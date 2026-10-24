import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { purgeAccountData } from "../account-portal/account-data-purge.js";
import { usageEnvShape } from "../config/usage-env.js";
import { createLogger } from "../logger.js";
import {
	CLIENT_USAGE_COLLECTION,
	CLIENT_USAGE_RETENTION_DAYS,
	clientUsageCollection,
} from "../usage/client-usage-model.js";
import { ClientUsageRecorder } from "../usage/client-usage-recorder.js";
import { openTestDb } from "./helpers/test-accounts.js";
import {
	OTHER_TEST_TENANT,
	PRIMARY_TEST_TENANT,
} from "./helpers/test-tenant.js";

let db: Db;
let close: () => Promise<void>;
const silent = createLogger("silent");

beforeAll(async () => {
	({ db, close } = await openTestDb());
});

afterAll(async () => {
	await close?.();
});

function recorder(
	tenant = PRIMARY_TEST_TENANT,
	enabled = true,
): ClientUsageRecorder {
	return new ClientUsageRecorder(db, tenant, silent, enabled);
}

describe("ClientUsageRecorder", () => {
	it("appends one document per sign-in, tagged with its tenant", async () => {
		const sub = `acc_${randomUUID()}`;
		const before = Date.now();
		await recorder().record(sub, "localman-web", "interactive");
		await recorder().record(sub, "chat-web", "sso");
		const docs = await clientUsageCollection(db)
			.find({ sub }, { projection: { _id: 0 } })
			.sort({ at: 1 })
			.toArray();
		expect(docs).toEqual([
			{
				tenantId: PRIMARY_TEST_TENANT.id,
				sub,
				clientId: "localman-web",
				kind: "interactive",
				at: expect.any(Date),
			},
			{
				tenantId: PRIMARY_TEST_TENANT.id,
				sub,
				clientId: "chat-web",
				kind: "sso",
				at: expect.any(Date),
			},
		]);
		expect(docs[0]?.at.getTime()).toBeGreaterThanOrEqual(before);
	});

	it("writes nothing when switched off, or without an account or client", async () => {
		const sub = `acc_${randomUUID()}`;
		await recorder(PRIMARY_TEST_TENANT, false).record(sub, "chat-web", "sso");
		await recorder().record(sub, "", "interactive");
		await recorder().record("", "chat-web", "sso");
		expect(await clientUsageCollection(db).countDocuments({ sub })).toBe(0);
		expect(await clientUsageCollection(db).countDocuments({ sub: "" })).toBe(0);
	});

	it("never throws when the write fails, and logs no account", async () => {
		const broken = db.client.db(`usage_broken_${randomUUID().slice(0, 8)}`);
		// Every insert is refused by the collection's validator.
		await broken.createCollection(CLIENT_USAGE_COLLECTION, {
			validator: { $jsonSchema: { required: ["neverPresent"] } },
		});
		const lines: string[] = [];
		const logger = createLogger("warn", {
			write: (line: string) => {
				lines.push(line);
			},
		});
		const sub = `acc_${randomUUID()}`;
		try {
			await expect(
				new ClientUsageRecorder(
					broken,
					PRIMARY_TEST_TENANT,
					logger,
					true,
				).record(sub, "chat-web", "sso"),
			).resolves.toBeUndefined();
		} finally {
			await broken.dropDatabase();
		}
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("Client usage not recorded");
		expect(lines[0]).toContain("chat-web");
		expect(lines[0]).not.toContain(sub);
	});

	it("is on unless CLIENT_USAGE_ENABLED is false", () => {
		const shape = z.object(usageEnvShape);
		expect(shape.parse({}).CLIENT_USAGE_ENABLED).toBe(true);
		expect(
			shape.parse({ CLIENT_USAGE_ENABLED: "false" }).CLIENT_USAGE_ENABLED,
		).toBe(false);
		expect(() => shape.parse({ CLIENT_USAGE_ENABLED: "no" })).toThrow();
	});
});

describe("client_usage storage", () => {
	it("expires after the retention period and reads by tenant", async () => {
		const indexes = await clientUsageCollection(db).indexes();
		expect(indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "at_ttl",
					key: { at: 1 },
					expireAfterSeconds: CLIENT_USAGE_RETENTION_DAYS * 24 * 60 * 60,
				}),
				expect.objectContaining({
					name: "tenant_at",
					key: { tenantId: 1, at: 1 },
				}),
				expect.objectContaining({
					name: "tenant_sub_at",
					key: { tenantId: 1, sub: 1, at: 1 },
				}),
			]),
		);
	});

	it("deletes an account's usage with the account, in its tenant only", async () => {
		const sub = `acc_${randomUUID()}`;
		const keeper = `acc_${randomUUID()}`;
		await recorder().record(sub, "localman-web", "interactive");
		await recorder().record(keeper, "localman-web", "interactive");
		// The same account id in another tenant is another person.
		await recorder(OTHER_TEST_TENANT).record(sub, "chat-web", "sso");

		const counts = await purgeAccountData(
			{ db, tenant: PRIMARY_TEST_TENANT },
			sub,
		);
		expect(counts).toContainEqual({
			collection: CLIENT_USAGE_COLLECTION,
			count: 1,
		});
		const usage = clientUsageCollection(db);
		expect(
			await usage.countDocuments({ tenantId: PRIMARY_TEST_TENANT.id, sub }),
		).toBe(0);
		expect(
			await usage.countDocuments({ tenantId: OTHER_TEST_TENANT.id, sub }),
		).toBe(1);
		expect(await usage.countDocuments({ sub: keeper })).toBe(1);
	});
});
