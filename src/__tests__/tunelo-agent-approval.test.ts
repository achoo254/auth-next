import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALES } from "../i18n/locales.js";
import { renderDeviceApproval } from "../interactions/device-verify-page.js";
import { DEVICE_CODE_GRANT, STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { TUNELO_AGENT_SCOPES } from "../oidc/tunelo-agent-client.js";
import { discoverClient } from "./helpers/flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown, testPage } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";
import { linkedGoogleProfile, signInWith } from "./helpers/upstream-sign-in.js";

const AGENT = STATIC_CLIENT_IDS.tuneloAgent;
const { tunnel, chatMcp, localmanMcp } = RESOURCES;

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("tunelo-agent approval page", () => {
	it.each(LOCALES)(
		"lists the three apps, the IP and the warning in %s",
		(locale) => {
			const page = renderDeviceApproval({
				page: testPage(locale),
				csrf: "csrf-token",
				uid: "uid-1",
				clientId: AGENT,
				clientName: "Tunelo",
				params: { device_name: "mac-mini" },
				deviceInfo: { ip: "203.0.113.7", ua: "tunelo/2.0.0" },
				userCode: "BCDFGHJK",
				scopes: TUNELO_AGENT_SCOPES,
				username: "minh_anh",
			});
			expect(page).toContain("<code>tunelo</code>");
			expect(page).toContain("<b>mac-mini</b>");
			expect(page).toContain("<code>203.0.113.7</code>");
			expect(page).toContain('data-id="device-agent-warning"');
			expect(page).toContain(shown("device.approve.agentWarning", locale));
			for (const app of ["tunelo", "chat", "localman"]) {
				expect(page).toContain(`data-id="device-app-${app}"`);
			}
			expect(page).toContain(shown("scope.machinesWrite", locale));
			expect(page).toContain(shown("scope.chatWrite", locale));
			expect(page).not.toContain(shown("scope.botsAdmin", locale));
		},
	);

	it("keeps the plain list for tunelo-cli", () => {
		const page = renderDeviceApproval({
			page: testPage("en"),
			csrf: "csrf-token",
			uid: "uid-1",
			clientId: STATIC_CLIENT_IDS.tuneloCli,
			params: undefined,
			deviceInfo: { ip: "203.0.113.7" },
			userCode: "BCDFGHJK",
			scopes: ["openid", "tunnels:open"],
			username: "minh_anh",
		});
		expect(page).not.toContain('data-id="device-agent-warning"');
		expect(page).not.toContain('data-id="device-app-tunelo"');
	});
});

describe("tunelo-agent device login", () => {
	it("is approved on the real pages, refreshes for each app, and dies when revoked at /account", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const { page } = await signInWith(
			idp,
			"google",
			linkedGoogleProfile(account),
		);
		const agent = await discoverClient(idp, AGENT, client.None());
		const body = new URLSearchParams({
			scope: TUNELO_AGENT_SCOPES.join(" "),
			device_name: "mac-mini",
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
		expect(approvalPage).toContain(
			"Allow <code>tunelo</code> on <b>mac-mini</b>?",
		);
		expect(approvalPage).toMatch(/requested from IP <code>[^<]+<\/code>/);
		expect(approvalPage).toContain('data-id="device-agent-warning"');
		expect(approvalPage).toContain('data-id="device-app-localman"');

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
		// The real consent page granted all three resources.
		let refreshToken = tokens.refresh_token ?? "";
		for (const resource of [chatMcp, localmanMcp, tunnel]) {
			const next = await client.refreshTokenGrant(agent, refreshToken, {
				resource,
			});
			refreshToken = next.refresh_token ?? "";
		}

		const accountPage = await (
			await page.browser.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain("mac-mini");
		const grantId =
			/\/account\/devices\/([\w-]+)\/revoke/.exec(accountPage)?.[1] ?? "";
		const revoked = await submitForm(
			page.browser,
			`${idp.issuer}/account/devices/${grantId}/revoke`,
			{ csrf: formField(accountPage, "csrf") },
		);
		expect(await revoked.response.text()).toContain("Signed out the device.");
		await expect(
			client.refreshTokenGrant(agent, refreshToken, { resource: chatMcp }),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});
});
