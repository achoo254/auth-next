import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { submitForm } from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { approveAgent } from "./helpers/tunelo-agent-login.js";

const { tunnel, chatMcp, localmanMcp } = RESOURCES;

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("tunelo-agent device login on the real pages", () => {
	it("shows the origin, refreshes for each app, and dies when revoked at /account", async () => {
		const { browser, agent, approvalPage, refreshToken } = await approveAgent(
			idp,
			"mac-mini",
		);
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
		const { browser, agent, refreshToken } = await approveAgent(
			idp,
			"lab-server",
		);
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
