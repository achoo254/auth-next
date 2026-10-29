import { expect, test } from "@playwright/test";
import { newUser, signUpViaAccountPage } from "./support/flows.js";

test("the header's account menu opens, closes and signs out under the page's CSP", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(String(error)));

	const user = newUser();
	await signUpViaAccountPage(page, user);
	const menu = page.locator('[data-id="account-menu"]');
	const trigger = page.locator('[data-id="topbar-account"]');
	const sessions = page.locator('[data-id="account-menu-sessions"]');
	await expect(page.locator('[data-id="nav-account"]')).toHaveCount(0);
	await expect(sessions).toBeHidden();

	// app-shell-enhance.js closes the server-rendered menu like React does.
	await trigger.click();
	await expect(sessions).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu).not.toHaveAttribute("open", "");
	await trigger.click();
	await page.locator('[data-id="account-overview"]').click();
	await expect(sessions).toBeHidden();

	// A section link jumps to its card and closes the menu.
	await trigger.click();
	await sessions.click();
	await expect(page).toHaveURL(/\/account#account-sessions$/);
	await expect(sessions).toBeHidden();

	// Sign-out goes to the IdP's end-session page, which asks first.
	await trigger.click();
	await page.locator('[data-id="account-menu-sign-out"]').click();
	await expect(page.locator('[data-id="logout-confirm"]')).toBeVisible();
	await page.locator('[data-id="logout-confirm"]').click();
	await expect(page.locator('[data-id="logout-signin-again"]')).toBeVisible();
	await page.goto("/account");
	await expect(page.locator('[data-id="account-menu"]')).toHaveCount(0);
	expect(errors).toEqual([]);
});
