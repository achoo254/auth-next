import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_CODE_GRANT, STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { TUNELO_AGENT_SCOPES } from "../oidc/tunelo-agent-client.js";
import { discoverClient } from "./helpers/flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { type TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { linkedGoogleProfile, signInWith } from "./helpers/upstream-sign-in.js";

const { tunnel, chatMcp, localmanMcp } = RESOURCES;

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

interface ApprovedAgent {
	readonly browser: TestBrowser;
	readonly agent: client.Configuration;
	readonly approvalPage: string;
	readonly refreshToken: string;
}

/**
 * A signed-in user types the agent's code on the real pages and allows it;
 * the agent redeems the device code for the tunnel.
 */
async function approveAgent(deviceName: string): Promise<ApprovedAgent> {
	const account = await createTestAccount(repositoryOf(idp));
	const { page } = await signInWith(
		idp,
		"google",
		linkedGoogleProfile(account),
	);
	const agent = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.tuneloAgent,
		client.None(),
	);
	const body = new URLSearchParams({
		scope: TUNELO_AGENT_SCOPES.join(" "),
		device_name: deviceName,
	});
	for (const resource of [tunnel, chatMcp, localmanMcp]) {
		body.append("resource", resource);
	}
	const device = await client.initiateDeviceAuthorization(agent, body);
	const input = await (
		await page.browser.request(device.verification_uri)
	).text();
	const approval = await submitForm(page.browser, device.verification_uri, {
		xsrf: formField(input, "xsrf"),
		user_code: device.user_code,
		confirm: "yes",
	});
	const approvalPage = await approval.response.text();
	const uid = /\/interaction\/([\w-]+)/.exec(approval.response.url)?.[1];
	const done = await submitForm(
		page.browser,
		`${idp.issuer}/interaction/${uid ?? ""}/consent`,
		{ csrf: formField(approvalPage, "csrf") },
	);
	expect(await done.response.text()).toContain("Allowed");
	const tokens = await client.genericGrantRequest(agent, DEVICE_CODE_GRANT, {
		device_code: device.device_code,
		resource: tunnel,
	});
	return {
		browser: page.browser,
		agent,
		approvalPage,
		refreshToken: tokens.refresh_token ?? "",
	};
}

describe("tunelo-agent device login on the real pages", () => {
	it("shows the origin, refreshes for each app, and dies when revoked at /account", async () => {
		const { browser, agent, approvalPage, refreshToken } =
			await approveAgent("mac-mini");
		expect(approvalPage).toContain(
			"Allow <code>tunelo</code> on <b>mac-mini</b>?",
		);
		expect(approvalPage).toMatch(
			/Request sent from <b>mac-mini<\/b>, IP <code data-id="device-origin-ip">[^<]+<\/code>/,
		);
		// The machine and the browser are both this test process.
		expect(approvalPage).not.toContain('data-id="device-ip-mismatch"');
		expect(approvalPage).toContain('data-id="device-agent-warning"');
		expect(approvalPage).toContain('data-id="device-app-localman"');

		// The real consent page granted all three resources.
		let latest = refreshToken;
		for (const resource of [chatMcp, localmanMcp, tunnel]) {
			const next = await client.refreshTokenGrant(agent, latest, {
				resource,
			});
			latest = next.refresh_token ?? "";
		}

		const accountPage = await (
			await browser.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain("Tunelo Agent · mac-mini");
		const grantId =
			/\/account\/devices\/([\w-]+)\/revoke/.exec(accountPage)?.[1] ?? "";
		const revoked = await submitForm(
			browser,
			`${idp.issuer}/account/devices/${grantId}/revoke`,
			{ csrf: formField(accountPage, "csrf") },
		);
		expect(await revoked.response.text()).toContain("Signed out the device.");
		await expect(
			client.refreshTokenGrant(agent, latest, { resource: chatMcp }),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("keeps its grant when the user signs out of the IdP", async () => {
		const { browser, agent, refreshToken } = await approveAgent("lab-server");
		const ask = await (
			await browser.request(`${idp.issuer}/session/end`)
		).text();
		await submitForm(browser, `${idp.issuer}/session/end/confirm`, {
			xsrf: formField(ask, "xsrf"),
			logout: "yes",
		});
		const refreshed = await client.refreshTokenGrant(agent, refreshToken, {
			resource: chatMcp,
		});
		expect(refreshed.refresh_token).toEqual(expect.any(String));
		expect(refreshed.refresh_token).not.toBe(refreshToken);
	});
});
