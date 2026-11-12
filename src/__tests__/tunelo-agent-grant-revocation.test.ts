import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { AGENT_GRANT_REVOKE_PATH } from "../oidc/agent-grant-revocation.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { cliLogin, signedInBrowser } from "./helpers/session-flows.js";
import { createTestAccount, repositoryOf } from "./helpers/test-accounts.js";
import {
	CHAT_WEB_SECRET,
	TUNELO_WEB_SECRET,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { approveAgent } from "./helpers/tunelo-agent-login.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function basic(id: string, secret: string): string {
	const pair = `${encodeURIComponent(id)}:${encodeURIComponent(secret)}`;
	return `Basic ${Buffer.from(pair).toString("base64")}`;
}

const CHAT_SERVER = basic(STATIC_CLIENT_IDS.chatWeb, CHAT_WEB_SECRET);

function revoke(
	body: unknown,
	/** `null` sends no Authorization header. */
	authorization: string | null = CHAT_SERVER,
): Promise<Response> {
	return fetch(`${idp.issuer}${AGENT_GRANT_REVOKE_PATH}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(authorization ? { authorization } : {}),
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

/** The `grant_id` claim of an agent access token, as Chat reads it. */
function grantIdOf(accessToken: string): string {
	const claim = decodeJwt(accessToken).grant_id;
	if (typeof claim !== "string") throw new Error("no grant_id claim");
	return claim;
}

describe("Chat revokes the grant of a removed Tunelo machine", () => {
	it("tags every agent access token with its grant, the same after refresh", async () => {
		const machine = await approveAgent(idp, "build-box");
		const grantId = grantIdOf(machine.accessToken);
		const chat = await client.refreshTokenGrant(
			machine.agent,
			machine.refreshToken,
			{ resource: RESOURCES.chatMcp },
		);
		expect(decodeJwt(chat.access_token).aud).toBe(RESOURCES.chatMcp);
		expect(grantIdOf(chat.access_token)).toBe(grantId);
	});

	it("leaves the access tokens of other clients without the claim", async () => {
		const browser = await signedInBrowser(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		const cli = await cliLogin(idp, browser);
		const refreshed = await client.refreshTokenGrant(
			cli.config,
			cli.refreshToken,
		);
		expect(decodeJwt(refreshed.access_token).grant_id).toBeUndefined();
	});

	it("kills the machine's refresh token, records it, and answers 204 again", async () => {
		const machine = await approveAgent(idp, "mac-mini");
		const other = await approveAgent(idp, "lab-server");
		const body = {
			sub: machine.accountId,
			grant_id: grantIdOf(machine.accessToken),
		};

		const done = await revoke(body);
		expect(done.status).toBe(204);
		await expect(
			client.refreshTokenGrant(machine.agent, machine.refreshToken, {
				resource: RESOURCES.chatMcp,
			}),
		).rejects.toMatchObject({ error: "invalid_grant" });
		const event = await auditOutboxCollection(idp.db).findOne({
			sub: machine.accountId,
			type: "grant.revoked",
		});
		expect(event?.data).toEqual({
			count: 1,
			cause: "machine-removed",
			clientId: STATIC_CLIENT_IDS.tuneloAgent,
		});
		expect(event?.context).toBeUndefined();
		// Retried by Chat after a timeout: still done.
		expect((await revoke(body)).status).toBe(204);

		// Another machine keeps working.
		const still = await client.refreshTokenGrant(
			other.agent,
			other.refreshToken,
			{ resource: RESOURCES.chatMcp },
		);
		expect(still.access_token).toEqual(expect.any(String));
	});

	it("refuses a grant of another account or another client", async () => {
		const machine = await approveAgent(idp, "pi");
		const grantId = grantIdOf(machine.accessToken);
		const stranger = await createTestAccount(repositoryOf(idp));
		const wrongOwner = await revoke({ sub: stranger._id, grant_id: grantId });
		expect(wrongOwner.status).toBe(404);
		expect(await wrongOwner.json()).toEqual({ error: "unknown_grant" });

		const browser = await signedInBrowser(
			idp,
			await createTestAccount(repositoryOf(idp)),
		);
		const cli = await cliLogin(idp, browser);
		const cliGrant = await idp.provider.RefreshToken.find(cli.refreshToken);
		const notAgent = await revoke({
			sub: cliGrant?.accountId ?? "",
			grant_id: cliGrant?.grantId ?? "",
		});
		expect(notAgent.status).toBe(404);

		const alive = await client.refreshTokenGrant(
			machine.agent,
			machine.refreshToken,
			{ resource: RESOURCES.tunnel },
		);
		expect(alive.access_token).toEqual(expect.any(String));
	});

	it("accepts only Chat's client credentials", async () => {
		const machine = await approveAgent(idp, "nas");
		const body = {
			sub: machine.accountId,
			grant_id: grantIdOf(machine.accessToken),
		};
		for (const authorization of [
			null,
			basic(STATIC_CLIENT_IDS.chatWeb, "wrong-secret"),
			basic(STATIC_CLIENT_IDS.tuneloWeb, TUNELO_WEB_SECRET),
			`Bearer ${machine.accessToken}`,
		]) {
			const refused = await revoke(body, authorization);
			expect(refused.status).toBe(401);
			expect(refused.headers.get("www-authenticate")).toMatch(/^Basic /);
			expect(await refused.json()).toEqual({ error: "invalid_client" });
		}
		const alive = await client.refreshTokenGrant(
			machine.agent,
			machine.refreshToken,
			{ resource: RESOURCES.tunnel },
		);
		expect(alive.access_token).toEqual(expect.any(String));
	});

	it("answers 400 to a body without a valid sub and grant_id", async () => {
		for (const body of [
			"not json",
			{},
			{ sub: "a", grant_id: "" },
			{ sub: "a b", grant_id: "g" },
		]) {
			const bad = await revoke(body);
			expect(bad.status).toBe(400);
			expect(await bad.json()).toEqual({ error: "invalid_request" });
		}
	});
});
