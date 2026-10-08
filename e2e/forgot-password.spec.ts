import { expect, test } from "@playwright/test";
import { FAKE_TELEGRAM_SECRET } from "../src/__tests__/helpers/fake-upstreams.js";
import { E2E_ISSUER } from "./support/e2e-config.js";
import {
	newUser,
	routeGoogle,
	signUpViaAccountPage,
	telegramMessages,
} from "./support/flows.js";
import {
	expectPasswordWorks,
	openForgot,
	passReview,
	setNewPassword,
} from "./support/reset-flows.js";

test("recovery code: resets the password once and signs in", async ({
	page,
	browser,
}) => {
	const user = newUser();
	const [code = ""] = await signUpViaAccountPage(page, user);

	const forgot = await openForgot(browser);
	const recovery = forgot.locator('[data-id="forgot-recovery"]');
	await recovery.getByLabel("Email hoặc username").fill(user.email);
	await recovery.getByLabel("Mã khôi phục").fill(code.toUpperCase());
	await recovery
		.getByLabel("Mật khẩu mới", { exact: true })
		.fill("da-doi-bang-ma");
	await recovery.getByLabel("Nhập lại mật khẩu mới").fill("da-doi-bang-ma");
	await forgot.locator('[data-id="forgot-recovery-submit"]').click();
	await passReview(forgot, ["Còn 7 mã"]);
	await expect(forgot.locator('[data-id="account-username"]')).toHaveText(
		`@${user.username}`,
	);
	await expect(forgot.locator('[data-id="recovery-remaining"]')).toHaveText(
		"7",
	);
	await expectPasswordWorks(browser, user, "da-doi-bang-ma");

	// The same code cannot be used twice.
	const reuse = await openForgot(browser);
	const again = reuse.locator('[data-id="forgot-recovery"]');
	await again.getByLabel("Email hoặc username").fill(user.username);
	await again.getByLabel("Mã khôi phục").fill(code);
	await again
		.getByLabel("Mật khẩu mới", { exact: true })
		.fill("lan-hai-khong-duoc");
	await again.getByLabel("Nhập lại mật khẩu mới").fill("lan-hai-khong-duoc");
	await reuse.locator('[data-id="forgot-recovery-submit"]').click();
	await expect(reuse.locator('[data-id="alert-error"]')).toHaveText(
		"Email/username hoặc mã khôi phục không đúng.",
	);
});

test("Telegram: link the chat, then reset through the link the bot sends", async ({
	page,
	browser,
	request,
}) => {
	const user = newUser();
	await signUpViaAccountPage(page, user);
	await page.locator('[data-id="telegram-link"]').click();
	const command = await page
		.locator('[data-id="telegram-start-command"]')
		.inputValue();
	const response = await request.post(`${E2E_ISSUER}/telegram/webhook`, {
		headers: { "x-telegram-bot-api-secret-token": FAKE_TELEGRAM_SECRET },
		data: {
			update_id: 1,
			message: { text: command, chat: { id: 5150, type: "private" } },
		},
	});
	expect(response.status()).toBe(200);
	// The bot asks first; the link happens when the button is pressed.
	const ask = (await telegramMessages())
		.filter((m) => m.chatId === "5150")
		.at(-1);
	expect(ask?.callbackData).toMatch(/^link:/);
	const press = await request.post(`${E2E_ISSUER}/telegram/webhook`, {
		headers: { "x-telegram-bot-api-secret-token": FAKE_TELEGRAM_SECRET },
		data: {
			update_id: 2,
			callback_query: {
				id: "cb-5150",
				data: ask?.callbackData,
				message: {
					chat: { id: 5150, type: "private", username: "nguoi_dung" },
				},
			},
		},
	});
	expect(press.status()).toBe(200);
	await page.goto("/account");
	await expect(page.locator('[data-id="telegram-status"]')).toContainText(
		"Đã liên kết với @nguoi_dung",
	);

	const forgot = await openForgot(browser);
	const section = forgot.locator('[data-id="forgot-telegram"]');
	await section.getByLabel("Email hoặc username").fill(user.username);
	await forgot.locator('[data-id="forgot-telegram-submit"]').click();
	await expect(forgot.locator('[data-id="alert-success"]')).toContainText(
		"bot hoandat vừa gửi link",
	);

	await expect
		.poll(
			async () =>
				(await telegramMessages()).filter(
					(m) => m.chatId === "5150" && m.buttonUrl,
				).length,
		)
		.toBe(1);
	const sent = (await telegramMessages()).find(
		(m) => m.chatId === "5150" && m.buttonUrl,
	);
	await forgot.goto(sent?.buttonUrl ?? "");
	await setNewPassword(forgot, "doi-qua-telegram", ["@nguoi_dung"]);
	await expectPasswordWorks(browser, user, "doi-qua-telegram");
	// The link was single-use.
	await forgot.goto(sent?.buttonUrl ?? "");
	await expect(forgot.locator('[data-id="error-message"]')).toContainText(
		"đã hết hạn hoặc đã được dùng",
	);
});

test("Google: a linked Google account sets a new password", async ({
	page,
	browser,
}) => {
	const user = newUser();
	await signUpViaAccountPage(page, user);
	const profile = {
		id: `g-${user.username}`,
		email: user.email.toLowerCase(),
		emailVerified: true,
	};
	await routeGoogle(page.context(), profile);
	await page.locator('[data-id="provider-link-google"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toHaveText(
		"Đã liên kết Google.",
	);
	await expect(
		page.locator('[data-id="account-email-verified"]'),
	).toContainText("Google");

	const forgot = await openForgot(browser);
	await routeGoogle(forgot.context(), profile);
	await forgot.locator('[data-id="upstream-google-reset"]').click();
	await setNewPassword(forgot, "doi-qua-google", [user.email.toLowerCase()]);
	await expectPasswordWorks(browser, user, "doi-qua-google");
});
