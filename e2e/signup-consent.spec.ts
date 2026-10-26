import { expect, test } from "@playwright/test";
import * as client from "openid-client";
import { MCP_CALLBACK } from "./support/e2e-config.js";
import { logIn, newUser, registerMcpClient, signUp } from "./support/flows.js";

test("sign up with Google, consent and return to the client; then sign in again", async ({
	browser,
}) => {
	const mcp = await registerMcpClient("Claude Code (localman)");
	const user = newUser();

	// 1. A coding agent sends the user to the IdP; they have no account yet.
	const first = await browser.newContext();
	const page = await first.newPage();
	const { url, checks } = await mcp.authorizationUrl();
	await page.goto(url.href);
	await expect(page).toHaveTitle(/Đăng nhập · hoandat\.com/);
	await expect(page.locator('[data-id="idp-brand"]')).toContainText(
		"hoandat.com · Tài khoản",
	);
	await signUp(page, user);

	// 2. Consent: a DCR client is always labelled as external and its name is
	// quoted. Its name reads like ours, but it returns to loopback (only the
	// user's own machine gets the code), so there is no red warning: that one
	// is for such names sending the code to a website.
	await expect(
		page.getByRole("heading", {
			name: "Cho phép một ứng dụng bên ngoài dùng tài khoản hoandat.com của bạn",
		}),
	).toBeVisible();
	await expect(page.locator('[data-id="consent-client-name"]')).toHaveText(
		"Claude Code (localman)",
	);
	await expect(page.locator('[data-id="consent-external"]')).toHaveText(
		"Ứng dụng bên ngoài",
	);
	await expect(
		page.locator('[data-id="consent-external-notice"]'),
	).toContainText("không do hoandat.com phát hành");
	await expect(
		page.locator('[data-id="consent-lookalike-warning"]'),
	).toHaveCount(0);
	await expect(page.locator('[data-id="consent-redirect-host"]')).toHaveText(
		"127.0.0.1:4591",
	);
	await expect(page.locator('[data-id="consent-scopes"]')).toContainText(
		"Tạo, sửa, xoá project và resource mock trên Localman, sinh hoặc reset dữ liệu",
	);
	await page.locator('[data-id="consent-allow"]').click();

	// 3. Back at the client with a code it can redeem.
	await page.waitForURL(`${MCP_CALLBACK}?**`);
	const tokens = await client.authorizationCodeGrant(
		mcp.config,
		new URL(page.url()),
		checks,
	);
	expect(tokens.access_token).toEqual(expect.any(String));
	await first.close();

	// 4. A fresh browser: sign in with the same Google account; consent is
	// asked again and no second account appears.
	const second = await browser.newContext();
	const again = await second.newPage();
	const next = await mcp.authorizationUrl();
	await again.goto(next.url.href);
	await logIn(again, user);
	await expect(again.locator('[data-id="consent-external"]')).toBeVisible();
	await again.locator('[data-id="consent-allow"]').click();
	await again.waitForURL(`${MCP_CALLBACK}?**`);
	const secondTokens = await client.authorizationCodeGrant(
		mcp.config,
		new URL(again.url()),
		next.checks,
	);
	expect(secondTokens.access_token).toEqual(expect.any(String));
	await second.close();
});

test("denying consent sends access_denied back to the client", async ({
	browser,
}) => {
	const mcp = await registerMcpClient("Some Agent");
	const context = await browser.newContext();
	const page = await context.newPage();
	const { url } = await mcp.authorizationUrl();
	await page.goto(url.href);
	await signUp(page, newUser());
	await expect(page.locator('[data-id="consent-external"]')).toBeVisible();
	await expect(
		page.locator('[data-id="consent-lookalike-warning"]'),
	).toHaveCount(0);
	await page.locator('[data-id="consent-deny"]').click();
	await page.waitForURL(`${MCP_CALLBACK}?**`);
	expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
	await context.close();
});
