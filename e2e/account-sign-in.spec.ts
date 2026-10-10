import { expect, test } from "@playwright/test";
import { FAKE_TELEGRAM_SECRET } from "../src/__tests__/helpers/fake-upstreams.js";
import { E2E_ISSUER } from "./support/e2e-config.js";
import {
	newUser,
	routeUpstream,
	signUpViaAccountPage,
	telegramMessages,
} from "./support/flows.js";

test("sign-in methods: link GitHub, unlink Google, never the last one", async ({
	page,
	browser,
}) => {
	const user = newUser();
	await signUpViaAccountPage(page, user);
	const section = page.locator("#account-sign-in");
	await expect(section).toBeVisible();
	await expect(section).not.toContainText("mật khẩu mới");
	await expect(page.locator('input[type="password"]')).toHaveCount(0);
	await expect(page.locator('[data-id="provider-google"]')).toContainText(
		"cách đăng nhập duy nhất",
	);
	await expect(page.locator('[data-id="provider-unlink-google"]')).toHaveCount(
		0,
	);

	const github = {
		id: `${Date.now()}`,
		email: user.email.toLowerCase(),
		emailVerified: true,
		name: user.username,
	};
	await routeUpstream(page.context(), "github", github);
	await page.locator('[data-id="provider-link-github"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toHaveText(
		"Đã liên kết GitHub.",
	);
	await page.locator('[data-id="provider-unlink-google"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toHaveText(
		"Đã huỷ liên kết.",
	);
	await expect(page.locator('[data-id="provider-github"]')).toContainText(
		"cách đăng nhập duy nhất",
	);
	await expect(page.locator('[data-id="provider-unlink-github"]')).toHaveCount(
		0,
	);

	// A fresh browser signs in with GitHub, into the same account.
	const other = await (await browser.newContext()).newPage();
	await other.goto("/account");
	await routeUpstream(other.context(), "github", github);
	await other.locator('[data-id="upstream-github"]').click();
	await expect(other.locator('[data-id="account-username"]')).toHaveText(
		`@${user.username}`,
	);
	await other.context().close();
});

test("Telegram: link the chat from /account for security notices", async ({
	page,
	request,
}) => {
	await signUpViaAccountPage(page, newUser());
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
	const confirmed = (await telegramMessages())
		.filter((m) => m.chatId === "5150")
		.at(-1);
	expect(confirmed?.text).toContain("thông báo bảo mật");
	expect(confirmed?.text).not.toContain("mật khẩu");
});
