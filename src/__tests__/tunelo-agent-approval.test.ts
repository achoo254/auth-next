import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../i18n/locales.js";
import {
	type DeviceApprovalView,
	renderDeviceApproval,
} from "../interactions/device-verify-page.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { TUNELO_AGENT_SCOPES } from "../oidc/tunelo-agent-client.js";
import { discoverClient } from "./helpers/flows.js";
import { submitForm } from "./helpers/test-accounts.js";
import { TestBrowser, formField } from "./helpers/test-browser.js";
import { type TestIdp, startTestIdp } from "./helpers/test-idp.js";
import { shown, testPage } from "./helpers/test-page.js";
import { RESOURCES } from "./helpers/test-tenant.js";

const AGENT = STATIC_CLIENT_IDS.tuneloAgent;
const MACHINE_IP = "203.0.113.7";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

function agentApproval(
	locale: Locale,
	extra: Partial<DeviceApprovalView> = {},
): string {
	return renderDeviceApproval({
		page: testPage(locale),
		csrf: "csrf-token",
		uid: "uid-1",
		clientId: AGENT,
		clientName: "Tunelo Agent",
		params: { device_name: "mac-mini" },
		deviceInfo: { ip: MACHINE_IP, ua: "tunelo/2.0.0" },
		userCode: "BCDFGHJK",
		scopes: TUNELO_AGENT_SCOPES,
		username: "minh_anh",
		...extra,
	});
}

describe("tunelo-agent approval page", () => {
	it.each(LOCALES)(
		"lists the three apps, the requesting machine and IP, and the warning in %s",
		(locale) => {
			const page = agentApproval(locale, { approverIp: MACHINE_IP });
			expect(page).toContain("<code>tunelo</code>");
			expect(page).toContain('data-id="device-origin"');
			expect(page).toContain(
				`<code data-id="device-origin-ip">${MACHINE_IP}</code>`,
			);
			expect(page).not.toContain('data-id="device-ip-mismatch"');
			expect(page).toContain('data-id="device-agent-warning"');
			expect(page).toContain(shown("device.approve.agentWarning", locale));
			expect(page).toContain(shown("device.agent.purpose", locale));
			for (const app of ["tunelo", "chat", "localman"]) {
				expect(page).toContain(`data-id="device-app-${app}"`);
			}
			expect(page).toContain(shown("scope.machinesWrite", locale));
			expect(page).not.toContain(shown("scope.botsAdmin", locale));
			// The origin sits right under the question, before the access lists.
			expect(page.indexOf('data-id="device-question"')).toBeLessThan(
				page.indexOf('data-id="device-origin"'),
			);
			expect(page.indexOf('data-id="device-origin"')).toBeLessThan(
				page.indexOf('data-id="device-scopes"'),
			);
		},
	);

	it.each(LOCALES)(
		"warns in %s when the approving browser has another IP",
		(locale) => {
			const page = agentApproval(locale, { approverIp: "198.51.100.20" });
			expect(page).toContain('data-id="device-ip-mismatch"');
			expect(page).toContain("<code>198.51.100.20</code>");
			const before = page.indexOf('data-id="device-ip-mismatch"');
			expect(before).toBeLessThan(page.indexOf('data-id="device-allow"'));
		},
	);

	it("treats an IPv4-mapped address as the same IP", () => {
		const page = agentApproval("en", { approverIp: `::ffff:${MACHINE_IP}` });
		expect(page).not.toContain('data-id="device-ip-mismatch"');
	});

	it("keeps the plain list and the IP in the code line for tunelo-cli", () => {
		const page = renderDeviceApproval({
			page: testPage("en"),
			csrf: "csrf-token",
			uid: "uid-1",
			clientId: STATIC_CLIENT_IDS.tuneloCli,
			params: undefined,
			deviceInfo: { ip: MACHINE_IP },
			userCode: "BCDFGHJK",
			scopes: ["openid", "tunnels:open"],
			username: "minh_anh",
			approverIp: "198.51.100.20",
		});
		expect(page).toContain(`requested from IP <code>${MACHINE_IP}</code>`);
		expect(page).not.toContain('data-id="device-origin"');
		expect(page).not.toContain('data-id="device-ip-mismatch"');
		expect(page).not.toContain('data-id="device-agent-warning"');
		expect(page).not.toContain('data-id="device-app-tunelo"');
		expect(page).not.toContain('data-id="device-agent-purpose"');
	});
});

describe("the prefilled code of tunelo-agent works only from the requesting IP", () => {
	async function authorize(
		clientId: string,
		scope: string,
		resource: string,
	): Promise<client.DeviceAuthorizationResponse> {
		const config = await discoverClient(idp, clientId, client.None());
		return client.initiateDeviceAuthorization(config, { scope, resource });
	}

	/**
	 * The verification page opened from the link carrying the code: the
	 * provider answers with a form the browser posts by itself.
	 */
	async function linkPage(
		device: client.DeviceAuthorizationResponse,
		browser: TestBrowser,
	): Promise<string> {
		const link = device.verification_uri_complete;
		if (!link) throw new Error("no verification_uri_complete");
		const autoPost = await (await browser.request(link)).text();
		const { response } = await submitForm(browser, device.verification_uri, {
			xsrf: formField(autoPost, "xsrf"),
			user_code: formField(autoPost, "user_code"),
		});
		return response.text();
	}

	it("gives the agent a prefilled link and shows the code to confirm on the same IP", async () => {
		const device = await authorize(
			AGENT,
			"openid tunnels:open",
			RESOURCES.tunnel,
		);
		expect(device.verification_uri_complete).toEqual(expect.any(String));
		// The machine and this browser are both the test process.
		const page = await linkPage(device, new TestBrowser());
		expect(page).toContain('data-id="device-confirm"');
		expect(page).toContain(device.user_code);
		expect(page).toContain('data-id="device-agent-purpose"');
		expect(page).toContain(shown("device.agent.purpose"));
		expect(page).not.toContain('data-id="device-user-code"');
	});

	it("asks for the code from the terminal when the browser has another IP", async () => {
		const device = await authorize(
			AGENT,
			"openid tunnels:open",
			RESOURCES.tunnel,
		);
		const page = await linkPage(device, new TestBrowser("198.51.100.20"));
		expect(page).toContain('data-id="device-user-code"');
		expect(page).toContain('data-id="device-agent-type-code"');
		expect(page).toContain(shown("device.input.agentHint"));
		expect(page).not.toContain('data-id="device-confirm"');
		expect(page).not.toContain(device.user_code);
	});

	it("keeps the prefilled link and the confirm page for tunelo-cli from any IP", async () => {
		const device = await authorize(
			STATIC_CLIENT_IDS.tuneloCli,
			"openid tunnels:open",
			RESOURCES.tunnel,
		);
		expect(device.verification_uri_complete).toEqual(expect.any(String));
		const page = await linkPage(device, new TestBrowser("198.51.100.20"));
		expect(page).toContain('data-id="device-confirm"');
		expect(page).toContain(device.user_code);
		expect(page).not.toContain('data-id="device-agent-purpose"');
	});
});
