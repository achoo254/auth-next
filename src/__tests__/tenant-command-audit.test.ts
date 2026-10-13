import type { CommandStartedEvent, Document } from "mongodb";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { grantIdsOf, revokeGrants } from "../account-portal/revoke-access.js";
import {
	listSessions,
	revokeSession,
} from "../account-portal/session-directory.js";
import { TENANT_COLLECTIONS } from "../tenants/tenant-collections.js";
import { codeTokens, exchange, localmanWeb } from "./helpers/exchange-flows.js";
import {
	accountPageStatus,
	cliLogin,
	signedInBrowser,
} from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

/**
 * Every command the IdP sends to a tenant-owned collection names the
 * tenant: reads, updates, deletes and counts filter on `tenantId`, inserts
 * carry it. Recorded while real flows run, so a query added anywhere (not
 * just in the modules the source scan knows) is caught.
 */
const commands: CommandStartedEvent[] = [];
let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({
		interactions: "real",
		onMongoCommand: (event) => commands.push(event),
	});
});

afterAll(async () => {
	await idp?.close();
});

const TENANT_OWNED = new Set(TENANT_COLLECTIONS);
const READ_ONLY = new Set(["getMore", "killCursors", "listIndexes"]);
const SCHEMA = new Set(["createIndexes", "dropIndexes", "dropDatabase"]);

/** True when `filter` constrains `tenantId` (directly or inside $and). */
function namesTenant(filter: unknown): boolean {
	if (typeof filter !== "object" || filter === null) return false;
	if ("tenantId" in filter) return true;
	const and: unknown = Reflect.get(filter, "$and");
	return Array.isArray(and) && and.some(namesTenant);
}

/** Filters (or inserted documents) a command applies to its collection. */
function scopesOf(name: string, command: Document): unknown[] {
	switch (name) {
		case "find":
			return [command.filter];
		case "findAndModify":
			return [command.query];
		case "update":
			return (command.updates as Document[]).map((update) => update.q);
		case "delete":
			return (command.deletes as Document[]).map((deletion) => deletion.q);
		case "insert":
			return command.documents as Document[];
		case "count":
			return [command.query];
		case "aggregate":
			return [(command.pipeline as Document[])[0]?.$match];
		default:
			return [undefined];
	}
}

describe("MongoDB commands on tenant-owned collections", () => {
	it("all name the tenant while the IdP serves real flows", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const browser = await signedInBrowser(idp, account);
		const config = await localmanWeb(idp);
		const tokens = await codeTokens(
			config,
			browser,
			LOCALMAN_CALLBACK,
			"openid profile email",
		);
		await client.refreshTokenGrant(config, tokens.refresh_token ?? "");
		await exchange(config, tokens.access_token).catch(() => undefined);
		expect(await accountPageStatus(idp, browser)).toBe(200);
		await cliLogin(idp, browser);
		const registered = await fetch(`${idp.issuer}/reg`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: "Agent",
				redirect_uris: ["http://127.0.0.1:9/cb"],
				token_endpoint_auth_method: "none",
			}),
		});
		expect(registered.status).toBe(201);
		await idp.services.audit.claimDue(new Date(), 1_000);
		await idp.services.audit.scrubStaleContext(new Date());
		const grants = await grantIdsOf(idp.services, account._id);
		await revokeGrants(idp.services, account._id, grants);
		const [session] = await listSessions(idp.services, account._id);
		await revokeSession(
			idp.provider,
			idp.services,
			idp.services.logger,
			account._id,
			session?.uid ?? "",
		);

		const relevant = commands.filter((event) => {
			const collection: unknown = event.command[event.commandName];
			return (
				typeof collection === "string" &&
				TENANT_OWNED.has(collection) &&
				!READ_ONLY.has(event.commandName) &&
				!SCHEMA.has(event.commandName)
			);
		});
		const seen = new Set(
			relevant.map((event) => event.command[event.commandName]),
		);
		// The flows touched every kind of tenant data.
		for (const name of [
			"accounts",
			"one_time_tokens",
			"audit_outbox",
			"session_meta",
			"grant_meta",
			"oidc_session",
			"oidc_grant",
			"oidc_refreshtoken",
			"oidc_devicecode",
			"oidc_client",
		]) {
			expect(seen, name).toContain(name);
		}
		const unscoped = relevant
			.filter((event) =>
				scopesOf(event.commandName, event.command).some(
					(scope) => !namesTenant(scope),
				),
			)
			.map(
				(event) => `${event.commandName} ${event.command[event.commandName]}`,
			);
		expect(unscoped).toEqual([]);
	});
});
