import { decodeJwt } from "jose";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountsCollection } from "../accounts/user-model.js";
import { TUNNEL_QUOTA_CLAIM } from "../oidc/tunnel-quota-claim.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { approveAgent } from "./helpers/tunelo-agent-login.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

async function setQuota(accountId: string, value: number): Promise<void> {
	await accountsCollection(idp.db).updateOne(
		{ _id: accountId },
		{ $set: { maxTunnels: value } },
	);
}

describe("max_tunnels claim on Tunelo access tokens", () => {
	it("is absent when the account has no quota, so Tunelo keeps its default", async () => {
		const machine = await approveAgent(idp, "quota-default");
		expect(decodeJwt(machine.accessToken).aud).toBe(RESOURCES.tunnel);
		expect(decodeJwt(machine.accessToken)[TUNNEL_QUOTA_CLAIM]).toBeUndefined();
	});

	it("carries the account's quota on tunnel tokens only", async () => {
		const machine = await approveAgent(idp, "quota-set");
		await setQuota(machine.accountId, 6);
		const tunnel = await client.refreshTokenGrant(
			machine.agent,
			machine.refreshToken,
			{ resource: RESOURCES.tunnel },
		);
		expect(decodeJwt(tunnel.access_token)[TUNNEL_QUOTA_CLAIM]).toBe(6);
		if (!tunnel.refresh_token) throw new Error("no rotated refresh token");
		const chat = await client.refreshTokenGrant(
			machine.agent,
			tunnel.refresh_token,
			{ resource: RESOURCES.chatMcp },
		);
		expect(decodeJwt(chat.access_token)[TUNNEL_QUOTA_CLAIM]).toBeUndefined();
	});

	it("ignores a value Tunelo would reject", async () => {
		const machine = await approveAgent(idp, "quota-invalid");
		await setQuota(machine.accountId, 0);
		const tunnel = await client.refreshTokenGrant(
			machine.agent,
			machine.refreshToken,
			{ resource: RESOURCES.tunnel },
		);
		expect(decodeJwt(tunnel.access_token)[TUNNEL_QUOTA_CLAIM]).toBeUndefined();
	});
});
