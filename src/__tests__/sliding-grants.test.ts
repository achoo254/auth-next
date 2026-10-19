import * as client from "openid-client";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { GRANT_META_COLLECTION } from "../account-portal/device-grants.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
import {
	GRANT_IDLE_SECONDS,
	hasHardCap,
	slidingLifetime,
} from "../oidc/sliding-grants.js";
import { deviceLogin, discoverClient } from "./helpers/flows.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const SCOPE = "openid offline_access tunnels:open tunnels:read";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "auto" });
});

afterAll(async () => {
	await idp?.close();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Signs the Tunelo CLI in "now" and returns the start time and tokens. */
async function cliLogin(): Promise<{
	config: client.Configuration;
	start: number;
	refreshToken: string;
}> {
	const start = Date.now();
	vi.useFakeTimers({ toFake: ["Date"], now: start });
	const config = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.tuneloCli,
		client.None(),
	);
	const tokens = await deviceLogin(config, SCOPE);
	if (!tokens.refresh_token) throw new Error("no refresh token");
	return { config, start, refreshToken: tokens.refresh_token };
}

async function refreshAt(
	config: client.Configuration,
	refreshToken: string,
	at: number,
): Promise<string> {
	vi.setSystemTime(at);
	const tokens = await client.refreshTokenGrant(config, refreshToken);
	if (!tokens.refresh_token) throw new Error("no rotated refresh token");
	return tokens.refresh_token;
}

/** Expiry (ms) of a stored artifact, read back from MongoDB. */
async function expiresAt(model: string, id: string): Promise<number> {
	const document = await idp.db
		.collection<{ _id: string; expiresAt?: Date }>(collectionNameFor(model))
		.findOne({ _id: id });
	return document?.expiresAt?.getTime() ?? 0;
}

describe("sliding Tunelo CLI sessions", () => {
	it("keeps an always-on device signed in past 90 days, sliding its /account entry too", async () => {
		const { config, start, refreshToken } = await cliLogin();
		const grantOf = async (token: string): Promise<string> =>
			(
				await idp.db
					.collection<{ _id: string; grantId?: string }>(
						collectionNameFor("RefreshToken"),
					)
					.findOne({ _id: token })
			)?.grantId ?? "";
		const grantId = await grantOf(refreshToken);
		// The device name row that consent writes for a real approval.
		await idp.db
			.collection<{ _id: string; tenantId: string; expiresAt: Date }>(
				GRANT_META_COLLECTION,
			)
			.insertOne({
				_id: grantId,
				tenantId: idp.tenant.id,
				expiresAt: new Date(start + 30 * DAY_MS),
			});

		const day29 = await refreshAt(config, refreshToken, start + 29 * DAY_MS);
		const day58 = await refreshAt(config, day29, start + 58 * DAY_MS);
		const day87 = await refreshAt(config, day58, start + 87 * DAY_MS);
		const day116 = await refreshAt(config, day87, start + 116 * DAY_MS);
		const day145 = await refreshAt(config, day116, start + 145 * DAY_MS);

		const thirtyDaysLater = start + (145 + 30) * DAY_MS;
		expect(await expiresAt("RefreshToken", day145)).toBeGreaterThan(
			thirtyDaysLater - 2_000,
		);
		expect(await expiresAt("Grant", grantId)).toBeGreaterThan(
			thirtyDaysLater - 2_000,
		);
		const meta = await idp.db
			.collection<{ _id: string; expiresAt: Date }>(GRANT_META_COLLECTION)
			.findOne({ _id: grantId });
		expect(meta?.expiresAt.getTime()).toBeGreaterThan(thirtyDaysLater - 2_000);
	});

	it("expires after 30 days without a refresh", async () => {
		const { config, start, refreshToken } = await cliLogin();
		await expect(
			refreshAt(config, refreshToken, start + 31 * DAY_MS),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("a refresh at day 29 is still usable at day 58", async () => {
		const { config, start, refreshToken } = await cliLogin();
		const day29 = await refreshAt(config, refreshToken, start + 29 * DAY_MS);
		await expect(
			refreshAt(config, day29, start + 58 * DAY_MS),
		).resolves.toEqual(expect.any(String));
	});
});

describe("the 90-day cap", () => {
	const DAY = 24 * 60 * 60;
	it("still ends every other client's grant 90 days after sign-in", () => {
		const start = 1_000_000;
		expect(hasHardCap(STATIC_CLIENT_IDS.localmanWeb)).toBe(true);
		expect(hasHardCap(STATIC_CLIENT_IDS.tuneloWeb)).toBe(true);
		expect(hasHardCap("some-mcp-client")).toBe(true);
		expect(hasHardCap(undefined)).toBe(true);
		expect(slidingLifetime(start, start + 87 * DAY)).toBe(3 * DAY);
	});

	it("does not apply to Tunelo CLI devices, which keep the 30-day idle limit", () => {
		const start = 1_000_000;
		expect(hasHardCap(STATIC_CLIENT_IDS.tuneloCli)).toBe(false);
		expect(slidingLifetime(start, start + 300 * DAY, false)).toBe(
			GRANT_IDLE_SECONDS,
		);
	});
});
