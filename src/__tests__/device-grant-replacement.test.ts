import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOutboxCollection } from "../audit/audit-outbox.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import type { TestIdp } from "./helpers/test-idp.js";
import { startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import {
	type ApprovedAgent,
	approveAgent,
	approveAgentAs,
} from "./helpers/tunelo-agent-login.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function refresh(machine: ApprovedAgent): Promise<unknown> {
	return client.refreshTokenGrant(machine.agent, machine.refreshToken, {
		resource: RESOURCES.tunnel,
	});
}

describe("a machine that signs in again replaces its older grant", () => {
	it("revokes the older grant of the same machine name and records it", async () => {
		const first = await approveAgent(idp, "build-box");
		const again = await approveAgentAs(
			idp,
			first.accountId,
			first.browser,
			"build-box",
		);

		await expect(refresh(first)).rejects.toMatchObject({
			error: "invalid_grant",
		});
		await expect(refresh(again)).resolves.toBeDefined();
		const event = await auditOutboxCollection(idp.db).findOne({
			sub: first.accountId,
			type: "grant.revoked",
		});
		expect(event?.data).toEqual({
			count: 1,
			cause: "replaced",
			clientId: STATIC_CLIENT_IDS.tuneloAgent,
		});
	});

	it("keeps the grants of other machine names and other accounts", async () => {
		const mine = await approveAgent(idp, "lab-server");
		const otherName = await approveAgentAs(
			idp,
			mine.accountId,
			mine.browser,
			"mac-mini",
		);
		const otherAccount = await approveAgent(idp, "lab-server");

		await expect(refresh(mine)).resolves.toBeDefined();
		await expect(refresh(otherName)).resolves.toBeDefined();
		await expect(refresh(otherAccount)).resolves.toBeDefined();
	});
});
