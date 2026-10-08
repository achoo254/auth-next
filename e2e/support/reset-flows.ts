import { type Browser, type Page, expect } from "@playwright/test";
import { type TestUser, logIn } from "./flows.js";

/** In a fresh browser: /account → login page → "Quên mật khẩu?". */
export async function openForgot(browser: Browser): Promise<Page> {
	const page = await (await browser.newContext()).newPage();
	await page.goto("/account");
	await page.locator('[data-id="login-forgot"]').click();
	await expect(
		page.getByRole("heading", { name: "Quên mật khẩu" }),
	).toBeVisible();
	return page;
}

/**
 * Sets the new password on a reset link page; the same browser lands on the
 * security review, which must list `review` and is then confirmed.
 */
export async function setNewPassword(
	page: Page,
	password: string,
	review: readonly string[],
): Promise<void> {
	await page.getByLabel("Mật khẩu mới", { exact: true }).fill(password);
	await page.getByLabel("Nhập lại mật khẩu mới").fill(password);
	await page.locator('[data-id="reset-submit"]').click();
	await passReview(page, review);
	await expect(
		page.getByRole("heading", { name: "Đã rà soát xong" }),
	).toBeVisible();
}

/**
 * The mandatory security review after a reset: it lists what is linked
 * (each `expected` text must appear), then "Tôi đã rà soát" continues.
 */
export async function passReview(
	page: Page,
	expected: readonly string[],
): Promise<void> {
	await expect(
		page.getByRole("heading", { name: "Rà soát bảo mật" }),
	).toBeVisible();
	for (const text of expected)
		await expect(page.locator("main")).toContainText(text);
	await page.locator('[data-id="review-done"]').click();
}

/** The new password signs in from yet another fresh browser. */
export async function expectPasswordWorks(
	browser: Browser,
	user: TestUser,
	password: string,
): Promise<void> {
	const page = await (await browser.newContext()).newPage();
	await page.goto("/account");
	await logIn(page, user.username, password);
	await expect(page.locator('[data-id="account-username"]')).toHaveText(
		`@${user.username}`,
	);
	await page.context().close();
}
