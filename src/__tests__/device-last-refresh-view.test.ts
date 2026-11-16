import { describe, expect, it } from "vitest";
import { accountView } from "../account-api/account-api-view.js";
import type { DeviceGrant } from "../account-portal/device-grants.js";
import type { AccountDocument } from "../accounts/user-model.js";

const ACCOUNT: AccountDocument = {
	_id: "acc_refresh",
	tenantId: "primary",
	username: "minh_anh",
	emailVerifiedBy: null,
	providers: {},
	createdAt: new Date(0),
};

function devicesOf(devices: readonly DeviceGrant[]) {
	return accountView({
		account: ACCOUNT,
		enabledProviders: [],
		telegramAvailable: false,
		sessions: [],
		devices,
		apps: [],
		currentGrantId: "grant-none",
	}).devices;
}

describe("GET /api/account devices[].lastRefreshAt", () => {
	it("carries the latest refresh as ISO 8601, null when there is none", () => {
		const base = {
			clientId: "tunelo-agent",
			scopes: [],
			appName: "Tunelo Agent",
		};
		const [renewed, never] = devicesOf([
			{
				...base,
				grantId: "grant-renewed",
				lastRefreshAt: new Date("2026-11-16T04:05:00.000Z"),
			},
			{ ...base, grantId: "grant-never" },
		]);
		expect(renewed?.lastRefreshAt).toBe("2026-11-16T04:05:00.000Z");
		expect(never?.lastRefreshAt).toBeNull();
	});
});
