import { expect, test } from "@playwright/test";
import * as client from "openid-client";
import {
	logIn,
	newUser,
	signUpViaAccountPage,
	tuneloCli,
} from "./support/flows.js";

const SCOPE = "openid offline_access tunnels:open tunnels:read";

test("with a session, approving a device asks to sign in no more", async ({
	page,
}) => {
	await signUpViaAccountPage(page, newUser());
	const cli = await tuneloCli();
	const device = await client.initiateDeviceAuthorization(cli, {
		scope: SCOPE,
		device_name: "laptop-cua-dat",
	});

	// The link with the code prefilled: check the code, then the approval.
	if (!device.verification_uri_complete)
		throw new Error("no verification_uri_complete");
	await page.goto(device.verification_uri_complete);
	await expect(page.locator('[data-id="device-code"]')).toHaveText(
		device.user_code,
	);
	await page.locator('[data-id="device-confirm"]').click();

	await expect(page.locator('[data-id="device-question"]')).toHaveText(
		"Cho phép tunelo trên máy laptop-cua-dat?",
	);
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await page.locator('[data-id="device-allow"]').click();
	await expect(
		page.getByRole("heading", { name: "Đã cho phép" }),
	).toBeVisible();

	const tokens = await client.genericGrantRequest(
		cli,
		"urn:ietf:params:oauth:grant-type:device_code",
		{ device_code: device.device_code },
	);
	expect(tokens.refresh_token).toEqual(expect.any(String));

	// The account page lists the machine under Devices.
	await page.goto("/account");
	await expect(page.locator('[data-id="account-devices"]')).toContainText(
		"laptop-cua-dat",
	);
});

test("without a session, the device page signs in first, then asks", async ({
	browser,
}) => {
	const user = newUser();
	const setup = await browser.newContext();
	await signUpViaAccountPage(await setup.newPage(), user);
	await setup.close();

	const context = await browser.newContext();
	const page = await context.newPage();
	const cli = await tuneloCli();
	const device = await client.initiateDeviceAuthorization(cli, {
		scope: SCOPE,
		device_name: "may-ban",
	});
	await page.goto(device.verification_uri);
	await page.locator('[data-id="device-user-code"]').fill(device.user_code);
	await page.locator('[data-id="device-continue"]').click();

	await expect(page.getByText("Đăng nhập để duyệt thiết bị.")).toBeVisible();
	await logIn(page, user);
	await expect(page.locator('[data-id="device-question"]')).toHaveText(
		"Cho phép tunelo trên máy may-ban?",
	);
	await page.locator('[data-id="device-deny"]').click();
	await expect(page.locator('[data-id="alert-info"]')).toContainText(
		"Đã từ chối",
	);
	await expect(
		client.genericGrantRequest(
			cli,
			"urn:ietf:params:oauth:grant-type:device_code",
			{ device_code: device.device_code },
		),
	).rejects.toMatchObject({ error: "access_denied" });
	await context.close();
});
