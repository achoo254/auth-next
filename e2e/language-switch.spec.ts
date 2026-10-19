import { expect, test } from "@playwright/test";
import { googleProfile, newUser, routeUpstream } from "./support/flows.js";

test.use({ locale: "en-US" });

test("signs in, reads /account in English, then switches to 中文 without script", async ({
	page,
}) => {
	const user = newUser();
	await page.goto("/account");
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
	await expect(page.locator('[data-id="upstream-google"] svg')).toHaveCount(1);
	await routeUpstream(page.context(), "google", googleProfile(user));
	await page.locator('[data-id="upstream-google"]').click();
	await page.getByLabel("Username").fill(user.username);
	await page.locator('[data-id="upstream-signup-submit"]').click();

	await expect(page).toHaveURL(/\/account$/);
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	for (const group of ["Account", "Security", "Connections"]) {
		await expect(
			page.getByRole("heading", { level: 2, name: group }),
		).toBeVisible();
	}
	await expect(page.locator('[data-id="session-current"]')).toHaveText(
		"This browser",
	);
	await expect(
		page.getByRole("button", { name: "Sign out this browser" }),
	).toBeVisible();

	await page.locator('[data-id="lang-zh-CN"]').click();
	await expect(page).toHaveURL(/\/account$/);
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText(
		"Auth Next 账号",
	);
	await expect(page.locator('[data-id="lang-zh-CN"]')).toHaveAttribute(
		"aria-current",
		"true",
	);
	// The choice sticks for the next page.
	await page.goto("/privacy");
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("隐私政策");
});

test("/account fits a 375 px phone without sideways scrolling", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	const user = newUser();
	await page.goto("/account");
	await routeUpstream(page.context(), "google", googleProfile(user));
	await page.locator('[data-id="upstream-google"]').click();
	await page.getByLabel("Username").fill(user.username);
	await page.locator('[data-id="upstream-signup-submit"]').click();
	await expect(page.locator('[data-id="account-sessions"]')).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test("/apps fits a 375 px phone without sideways scrolling", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/apps");
	await expect(page.locator('[data-id="apps-hub"]')).toBeVisible();
	await expect(page.locator('[data-id="app-list"] > li')).toHaveCount(5);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
