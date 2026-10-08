import * as client from "openid-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { discoverClient, pollDeviceCode } from "./helpers/flows.js";
import {
	TEST_PASSWORD,
	createTestAccount,
	openLoginPage,
	postLogin,
	repositoryOf,
	submitForm,
} from "./helpers/test-accounts.js";
import { formField } from "./helpers/test-browser.js";
import {
	LOCALMAN_CALLBACK,
	type TestIdp,
	startTestIdp,
} from "./helpers/test-idp.js";

let idp: TestIdp;

beforeAll(async () => {
	idp = await startTestIdp({ interactions: "real", rateLimits: [] });
});

afterAll(async () => {
	await idp?.close();
});

describe("first-party apps and devices with an existing session", () => {
	it("signs in to localman-web without a consent page, then approves a device without a password", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		const { location } = await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/login`,
			{
				form: {
					csrf: page.csrf,
					identifier: account.username,
					password: TEST_PASSWORD,
				},
			},
			LOCALMAN_CALLBACK,
		);
		expect(location?.searchParams.get("code")).toEqual(expect.any(String));

		const cli = await discoverClient(
			idp,
			STATIC_CLIENT_IDS.tuneloCli,
			client.None(),
		);
		const device = await client.initiateDeviceAuthorization(cli, {
			scope: "openid offline_access tunnels:open tunnels:read",
			device_name: "may-cua-dat",
		});
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
			"Cho phép <code>tunelo</code> trên máy <b>may-cua-dat</b>?",
		);
		expect(approvalPage).not.toContain('type="password"');
		await expect(pollDeviceCode(cli, device.device_code)).rejects.toMatchObject(
			{ error: "authorization_pending" },
		);

		const approvalUid =
			/\/interaction\/([\w-]+)/.exec(approval.response.url)?.[1] ?? "";
		const done = await submitForm(
			page.browser,
			`${idp.issuer}/interaction/${approvalUid}/consent`,
			{ csrf: formField(approvalPage, "csrf") },
		);
		expect(await done.response.text()).toContain("Đã cho phép");
		const tokens = await pollDeviceCode(cli, device.device_code);
		expect(tokens.refresh_token).toEqual(expect.any(String));

		// The account page lists the device; revoking it kills its refresh token.
		const accountPage = await (
			await page.browser.request(`${idp.issuer}/account`)
		).text();
		expect(accountPage).toContain("may-cua-dat");
		expect(accountPage).toContain(`@${account.username}`);
		const grantId =
			/\/account\/devices\/([\w-]+)\/revoke/.exec(accountPage)?.[1] ?? "";
		const revoked = await submitForm(
			page.browser,
			`${idp.issuer}/account/devices/${grantId}/revoke`,
			{ csrf: formField(accountPage, "csrf") },
		);
		expect(await revoked.response.text()).toContain("Đã thu hồi thiết bị");
		await expect(
			client.refreshTokenGrant(cli, tokens.refresh_token ?? ""),
		).rejects.toMatchObject({ error: "invalid_grant" });
	});

	it("rejects account-page writes without the session's CSRF token", async () => {
		const account = await createTestAccount(repositoryOf(idp));
		const page = await openLoginPage(idp);
		// Google, GitHub and Telegram are not configured here: no trace of them.
		expect(page.html).not.toContain("/upstream/");
		const forgot = await (
			await page.browser.request(`${idp.issuer}/interaction/${page.uid}/forgot`)
		).text();
		expect(forgot).toContain("Dùng mã khôi phục");
		expect(forgot).not.toContain("Telegram");
		await page.browser.navigate(
			`${idp.issuer}/interaction/${page.uid}/login`,
			{
				form: {
					csrf: page.csrf,
					identifier: account.username,
					password: TEST_PASSWORD,
				},
			},
			LOCALMAN_CALLBACK,
		);
		const response = await page.browser.request(
			`${idp.issuer}/account/profile`,
			{ form: { name: "Kẻ giả mạo" } },
		);
		expect(response.headers.get("location")).toBe("/account?notice=expired");
		expect(
			(await repositoryOf(idp).findActiveById(account._id))?.name,
		).toBeUndefined();
		expect(
			(await postLogin(idp, await openLoginPage(idp), account.username, "nope"))
				.status,
		).toBe(401);
	});
});
