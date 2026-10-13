import type { Db } from "mongodb";
import { errors } from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listGrants } from "../account-portal/grant-directory.js";
import { listSessions } from "../account-portal/session-directory.js";
import { AccountRepository } from "../accounts/account-repository.js";
import { AccountTokens } from "../accounts/account-tokens.js";
import { OneTimeTokenStore, randomToken } from "../accounts/one-time-tokens.js";
import { AuditOutbox } from "../audit/audit-outbox.js";
import { createLogger } from "../logger.js";
import { MongoAdapter } from "../oidc/mongo-adapter.js";
import { tenantResourcePolicy } from "../oidc/provider.js";
import { parseExchangeRequest } from "../oidc/token-exchange-request.js";
import { openTestDb } from "./helpers/test-accounts.js";
import {
	OTHER_TEST_TENANT,
	PRIMARY_TEST_TENANT,
	RESOURCES,
} from "./helpers/test-tenant.js";

const logger = createLogger("silent");
let db: Db;
let close: () => Promise<void>;

function repository(tenant: typeof PRIMARY_TEST_TENANT): AccountRepository {
	return new AccountRepository(db, tenant, new AuditOutbox(db, tenant, logger));
}

beforeAll(async () => {
	({ db, close } = await openTestDb());
});

afterAll(async () => {
	await close?.();
});

describe("tenant data isolation", () => {
	it("lets the same Google account, email and username exist once per tenant", async () => {
		const input = {
			username: "same_name",
			email: "same@example.com",
			emailVerifiedBy: "google" as const,
			providers: { google: "google-sub-1" },
		};
		const mine = await repository(PRIMARY_TEST_TENANT).create(input);
		const theirs = await repository(OTHER_TEST_TENANT).create(input);
		expect(mine._id).not.toBe(theirs._id);
		await expect(
			repository(PRIMARY_TEST_TENANT).create({
				...input,
				username: "x_y_z",
				providers: { google: "google-sub-2" },
			}),
		).rejects.toMatchObject({ field: "email" });
		const found = await repository(OTHER_TEST_TENANT).findByProvider(
			"google",
			"google-sub-1",
		);
		expect(found?._id).toBe(theirs._id);
		expect(
			await repository(OTHER_TEST_TENANT).findActiveById(mine._id),
		).toBeUndefined();
		expect(
			await repository(OTHER_TEST_TENANT).findByEmail("same@example.com"),
		).toMatchObject({ _id: theirs._id });
		// The other direction: the primary tenant also reads untagged data,
		// never another tenant's.
		const primary = repository(PRIMARY_TEST_TENANT);
		expect(await primary.findActiveById(theirs._id)).toBeUndefined();
		expect(
			await primary.findByProvider("google", "google-sub-1"),
		).toMatchObject({ _id: mine._id });
		expect(await primary.findByEmail("same@example.com")).toMatchObject({
			_id: mine._id,
		});
		const onlyTheirs = await repository(OTHER_TEST_TENANT).create({
			username: "only_theirs",
			emailVerifiedBy: null,
			providers: { github: "gh-theirs" },
		});
		expect(await primary.findByProvider("github", "gh-theirs")).toBeUndefined();
		expect(await primary.usernameTaken("only_theirs")).toBe(false);
		await primary.updateName(onlyTheirs._id, "changed");
		expect(
			await repository(OTHER_TEST_TENANT).findActiveById(onlyTheirs._id),
		).not.toHaveProperty("name");
		expect(
			await primary.links.setTelegram(onlyTheirs._id, { chatId: "77" }),
		).toMatchObject({ applied: false });
	});

	it("keeps one-time and account tokens to their tenant", async () => {
		const token = randomToken();
		await new OneTimeTokenStore(db, PRIMARY_TEST_TENANT).put(
			"upstream-state",
			token,
			{ provider: "google" },
			60,
		);
		const other = new OneTimeTokenStore(db, OTHER_TEST_TENANT);
		expect(await other.peek("upstream-state", token)).toBeUndefined();
		const theirToken = randomToken();
		await other.put("upstream-state", theirToken, { provider: "github" }, 60);
		expect(
			await new OneTimeTokenStore(db, PRIMARY_TEST_TENANT).take(
				"upstream-state",
				theirToken,
			),
		).toBeUndefined();
		expect(await other.take("upstream-state", token)).toBeUndefined();
		expect(
			await new OneTimeTokenStore(db, PRIMARY_TEST_TENANT).take(
				"upstream-state",
				token,
			),
		).toEqual({ provider: "google" });

		const accounts = repository(PRIMARY_TEST_TENANT);
		const account = await accounts.create({
			username: "token_owner",
			emailVerifiedBy: null,
			providers: { github: "gh-1" },
		});
		const linkCode = randomToken();
		await new AccountTokens(db, accounts).issue(
			"telegram-link",
			linkCode,
			account._id,
			{},
			60,
		);
		const otherTokens = new AccountTokens(db, repository(OTHER_TEST_TENANT));
		expect(await otherTokens.peek("telegram-link", linkCode)).toEqual({
			status: "missing",
		});
	});

	it("delivers audit events only from their tenant's outbox", async () => {
		await new AuditOutbox(db, OTHER_TEST_TENANT, logger).record(
			"login.succeeded",
			"acc_other",
			{ methods: ["github"] },
		);
		await new AuditOutbox(db, PRIMARY_TEST_TENANT, logger).record(
			"login.succeeded",
			"acc_primary",
			{ methods: ["google"] },
		);
		// The other tenant's event is older, so a leaky filter would lease it first.
		const mine = new AuditOutbox(db, PRIMARY_TEST_TENANT, logger);
		expect(await mine.claimDue(new Date(), 1_000)).toMatchObject({
			sub: "acc_primary",
			tenantId: PRIMARY_TEST_TENANT.id,
		});
		expect(await mine.claimDue(new Date(), 1_000)).toBeUndefined();
		const other = new AuditOutbox(db, OTHER_TEST_TENANT, logger);
		expect(await other.claimDue(new Date(), 1_000)).toMatchObject({
			sub: "acc_other",
		});
		expect(await other.claimDue(new Date(), 1_000)).toBeUndefined();
	});

	it("keeps provider artifacts, grants and sessions to their tenant", async () => {
		const grants = new MongoAdapter(db, "Grant", PRIMARY_TEST_TENANT);
		await grants.upsert(
			"grant-1",
			{ accountId: "acc_g", clientId: "localman-web", iat: 1 },
			60,
		);
		await new MongoAdapter(db, "Session", PRIMARY_TEST_TENANT).upsert(
			"session-1",
			{ accountId: "acc_g", uid: "uid-1", loginTs: 1 },
			60,
		);
		const theirGrants = new MongoAdapter(db, "Grant", OTHER_TEST_TENANT);
		expect(await theirGrants.find("grant-1")).toBeUndefined();
		await theirGrants.destroy("grant-1");
		expect(await grants.find("grant-1")).toBeDefined();
		// Writing an id another tenant holds fails instead of overwriting it.
		await expect(
			theirGrants.upsert("grant-1", { accountId: "acc_x" }, 60),
		).rejects.toThrow(/duplicate key/);
		const other = { db, tenant: OTHER_TEST_TENANT };
		expect(await listGrants(other, "acc_g")).toEqual([]);
		expect(await listSessions(other, "acc_g")).toEqual([]);
		const mine = { db, tenant: PRIMARY_TEST_TENANT };
		expect(await listGrants(mine, "acc_g")).toHaveLength(1);
		expect(await listSessions(mine, "acc_g")).toHaveLength(1);
		// Theirs, under ids and an account the primary tenant also queries.
		await theirGrants.upsert(
			"grant-theirs",
			{ accountId: "acc_g", clientId: "localman-web", iat: 2 },
			60,
		);
		await new MongoAdapter(db, "Session", OTHER_TEST_TENANT).upsert(
			"session-theirs",
			{ accountId: "acc_g", uid: "uid-theirs", loginTs: 2 },
			60,
		);
		expect(await grants.find("grant-theirs")).toBeUndefined();
		expect(
			await new MongoAdapter(db, "Session", PRIMARY_TEST_TENANT).findByUid(
				"uid-theirs",
			),
		).toBeUndefined();
		await grants.revokeByGrantId("grant-theirs");
		await grants.destroy("grant-theirs");
		expect(await theirGrants.find("grant-theirs")).toBeDefined();
		expect(await listGrants(mine, "acc_g")).toHaveLength(1);
		expect(await listSessions(mine, "acc_g")).toHaveLength(1);
	});

	it("issues and exchanges tokens only for its own audiences", async () => {
		const theirs = tenantResourcePolicy(OTHER_TEST_TENANT);
		expect(theirs.isResourceIndicator(RESOURCES.localman)).toBe(false);
		expect(theirs.isResourceIndicator("https://localman.example.org")).toBe(
			true,
		);
		const request = {
			subject_token: "opaque",
			subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
			resource: RESOURCES.tunnel,
		};
		expect(() =>
			parseExchangeRequest(request, theirs.resources.tunnel),
		).toThrow(errors.InvalidTarget);
		expect(
			parseExchangeRequest(
				{ ...request, resource: "https://tunnel.example.org" },
				theirs.resources.tunnel,
			),
		).toEqual({ subjectToken: "opaque" });
	});
});
