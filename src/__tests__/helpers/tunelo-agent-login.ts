import * as client from "openid-client";
import { expect } from "vitest";
import { DEVICE_CODE_GRANT, STATIC_CLIENT_IDS } from "../../oidc/clients.js";
import { TUNELO_AGENT_SCOPES } from "../../oidc/tunelo-agent-client.js";
import { discoverClient } from "./flows.js";
import {
	createTestAccount,
	repositoryOf,
	submitForm,
} from "./test-accounts.js";
import { type TestBrowser, formField } from "./test-browser.js";
import type { TestIdp } from "./test-idp.js";
import { RESOURCES } from "./test-tenant.js";
import { linkedGoogleProfile, signInWith } from "./upstream-sign-in.js";

export interface ApprovedAgent {
	readonly accountId: string;
	readonly browser: TestBrowser;
	readonly agent: client.Configuration;
	readonly approvalPage: string;
	/** The tunnel access token the device code was redeemed for. */
	readonly accessToken: string;
	readonly refreshToken: string;
}

/**
 * A signed-in user types the agent's code on the real pages and allows it;
 * the agent redeems the device code for the tunnel.
 */
export async function approveAgent(
	idp: TestIdp,
	deviceName: string,
): Promise<ApprovedAgent> {
	const account = await createTestAccount(repositoryOf(idp));
	const { page } = await signInWith(
		idp,
		"google",
		linkedGoogleProfile(account),
	);
	return approveAgentAs(idp, account._id, page.browser, deviceName);
}

/** The same approval by an account already signed in on `browser`. */
export async function approveAgentAs(
	idp: TestIdp,
	accountId: string,
	browser: TestBrowser,
	deviceName: string,
): Promise<ApprovedAgent> {
	const page = { browser };
	const agent = await discoverClient(
		idp,
		STATIC_CLIENT_IDS.tuneloAgent,
		client.None(),
	);
	const body = new URLSearchParams({
		scope: TUNELO_AGENT_SCOPES.join(" "),
		device_name: deviceName,
	});
	const { tunnel, chatMcp, localmanMcp } = RESOURCES;
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
		resource: RESOURCES.tunnel,
	});
	return {
		accountId,
		browser,
		agent,
		approvalPage,
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token ?? "",
	};
}
