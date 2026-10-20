import { expect, test } from "@playwright/test";
import { logIn, newUser, signUpViaAccountPage } from "./support/flows.js";

test("delete my account: confirm with the username, then signing in again starts over", async ({
	page,
	browser,
}) => {
	const user = newUser();
	await signUpViaAccountPage(page, user);
	await page.locator('[data-id="account-delete-open"]').click();
	await expect(page.locator('[data-id="confirm-title"]')).toHaveText(
		/Xoá tài khoản/,
	);

	await page.locator('[data-id="input-username"]').fill("ai_do_khac");
	await page.locator('[data-id="account-delete-confirm"]').click();
	await expect(page.locator('[data-id="alert-error"]')).toHaveText(
		"Tên đăng nhập không khớp. Tài khoản chưa bị xoá.",
	);

	await page.locator('[data-id="account-delete-open"]').click();
	await page.locator('[data-id="input-username"]').fill(`@${user.username}`);
	await page.locator('[data-id="account-delete-confirm"]').click();
	await expect(page.locator('[data-id="account-deleted"]')).toHaveText(
		"Đã xoá tài khoản",
	);

	// The same Google account now signs up afresh: the old account is gone.
	const fresh = await (await browser.newContext()).newPage();
	await fresh.goto("/account");
	await logIn(fresh, user);
	await expect(
		fresh.getByRole("heading", { name: "Chọn username" }),
	).toBeVisible();
	await fresh.context().close();
});
