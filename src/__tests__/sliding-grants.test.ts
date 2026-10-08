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
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { collectionNameFor } from "../oidc/mongo-adapter.js";
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
	it("extends on every refresh, never past 90 days from sign-in", async () => {
		const { config, start, refreshToken } = await cliLogin();
		// Day 29 refresh keeps the session alive until day 59, so day 58 works.
		const day29 = await refreshAt(config, refreshToken, start + 29 * DAY_MS);
		const day58 = await refreshAt(config, day29, start + 58 * DAY_MS);
		const day87 = await refreshAt(config, day58, start + 87 * DAY_MS);

		const grantId = (
			await idp.db
				.collection<{ _id: string; grantId?: string }>(
					collectionNameFor("RefreshToken"),
				)
				.findOne({ _id: day87 })
		)?.grantId;
		const cap = start + 90 * DAY_MS;
		// At day 87 neither the token nor the grant may run the full 30 days.
		expect(await expiresAt("RefreshToken", day87)).toBeLessThanOrEqual(
			cap + 1_000,
		);
		expect(await expiresAt("RefreshToken", day87)).toBeGreaterThan(cap - 2_000);
		expect(await expiresAt("Grant", grantId ?? "")).toBeLessThanOrEqual(
			cap + 1_000,
		);

		// Day 89 still works; past day 90 nothing does.
		const day89 = await refreshAt(config, day87, start + 89 * DAY_MS);
		await expect(refreshAt(config, day89, cap + 60_000)).rejects.toMatchObject({
			error: "invalid_grant",
		});
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
