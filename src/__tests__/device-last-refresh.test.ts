import type { KoaContextWithOIDC } from "oidc-provider";
import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GRANT_META_COLLECTION } from "../account-portal/device-grants.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import { createRotateAndSlideGrant } from "../oidc/sliding-grants.js";
import type { TestIdp } from "./helpers/test-idp.js";
import { startTestIdp } from "./helpers/test-idp.js";
import { OTHER_TEST_TENANT, RESOURCES } from "./helpers/test-tenant.js";
import {
	type ApprovedAgent,
	approveAgent,
} from "./helpers/tunelo-agent-login.js";

interface MetaRow {
	_id: string;
	tenantId: string;
	expiresAt: Date;
	lastRefreshAt?: Date;
}

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function metas() {
	return idp.db.collection<MetaRow>(GRANT_META_COLLECTION);
}

async function grantIdOf(refreshToken: string): Promise<string> {
	const token = await idp.db
		.collection<{ _id: string; grantId?: string }>(
			collectionNameFor("RefreshToken"),
		)
		.findOne({ _id: refreshToken });
	if (!token?.grantId) throw new Error("refresh token has no grant");
	return token.grantId;
}

async function refresh(machine: ApprovedAgent): Promise<string> {
	const tokens = await client.refreshTokenGrant(
		machine.agent,
		machine.refreshToken,
		{ resource: RESOURCES.tunnel },
	);
	if (!tokens.refresh_token) throw new Error("no rotated refresh token");
	return tokens.refresh_token;
}

async function accountPage(machine: ApprovedAgent): Promise<string> {
	const response = await machine.browser.request(`${idp.issuer}/account`);
	expect(response.status).toBe(200);
	return response.text();
}

/**
 * The hook as oidc-provider calls it, for a grant already in context. Only
 * the fields the hook reads are filled, hence the cast.
 */
function runHook(grant: {
	jti: string;
	clientId: string;
	iat: number;
	exp: number;
}): Promise<boolean> {
	const ctx = { oidc: { entities: { Grant: grant } } };
	return createRotateAndSlideGrant({ db: idp.db, tenant: idp.tenant })(
		ctx as unknown as KoaContextWithOIDC,
	);
}

describe("last refresh of a device grant", () => {
	it("is stamped on every refresh and shown at /account once it exists", async () => {
		const machine = await approveAgent(idp, "idle-box");
		const grantId = await grantIdOf(machine.refreshToken);
		const marker = `data-id="device-refreshed-${grantId}"`;

		expect((await metas().findOne({ _id: grantId }))?.lastRefreshAt).toBe(
			undefined,
		);
		const before = await accountPage(machine);
		expect(before).toContain(`data-id="device-${grantId}"`);
		expect(before).not.toContain(marker);

		const startedAt = Date.now();
		await refresh(machine);
		const stamped = await metas().findOne({ _id: grantId });
		expect(stamped?.lastRefreshAt?.getTime()).toBeGreaterThanOrEqual(
			startedAt - 1_000,
		);
		const after = await accountPage(machine);
		expect(after).toContain(marker);
		expect(after).toContain("Last renewed");
	});

	it("is stamped even when the refresh does not move the grant's expiry", async () => {
		const machine = await approveAgent(idp, "steady-box");
		const grantId = await grantIdOf(machine.refreshToken);
		// An expiry already past what this refresh would slide it to.
		const farExp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
		await idp.db
			.collection<{ _id: string }>(collectionNameFor("Grant"))
			.updateOne(
				{ _id: grantId },
				{ $set: { "payload.exp": farExp, expiresAt: new Date(farExp * 1000) } },
			);
		const metaExpiry = (await metas().findOne({ _id: grantId }))?.expiresAt;

		const startedAt = Date.now();
		await refresh(machine);

		const grant = await idp.db
			.collection<{ _id: string; payload: { exp: number } }>(
				collectionNameFor("Grant"),
			)
			.findOne({ _id: grantId });
		expect(grant?.payload.exp).toBe(farExp);
		const meta = await metas().findOne({ _id: grantId });
		expect(meta?.expiresAt).toEqual(metaExpiry);
		expect(meta?.lastRefreshAt?.getTime()).toBeGreaterThanOrEqual(
			startedAt - 1_000,
		);
	});

	it("is not stamped for a grant that is not per device", async () => {
		const jti = `grant-web-${Date.now()}`;
		await metas().insertOne({
			_id: jti,
			tenantId: idp.tenant.id,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const now = Math.floor(Date.now() / 1000);
		await runHook({
			jti,
			clientId: STATIC_CLIENT_IDS.localmanWeb,
			iat: now,
			exp: now + 365 * 24 * 60 * 60,
		});
		expect((await metas().findOne({ _id: jti }))?.lastRefreshAt).toBe(
			undefined,
		);
	});

	it("never touches the metadata of another tenant", async () => {
		const jti = `grant-other-${Date.now()}`;
		await metas().insertOne({
			_id: jti,
			tenantId: OTHER_TEST_TENANT.id,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const now = Math.floor(Date.now() / 1000);
		await runHook({
			jti,
			clientId: STATIC_CLIENT_IDS.tuneloAgent,
			iat: now,
			exp: now + 365 * 24 * 60 * 60,
		});
		expect((await metas().findOne({ _id: jti }))?.lastRefreshAt).toBe(
			undefined,
		);
	});
});
