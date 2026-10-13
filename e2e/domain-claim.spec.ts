import { expect, test } from "@playwright/test";
import { E2E_SERVICE_IP, E2E_TOOLS } from "./support/e2e-config.js";
import { newUser, signUpViaAccountPage } from "./support/flows.js";

/** Sets fake DNS records (`TXT <name>` / `A <name>` → values). */
async function setDns(entries: readonly [string, string[]][]): Promise<void> {
	const response = await fetch(`${E2E_TOOLS}/dns`, {
		method: "POST",
		body: JSON.stringify(entries),
	});
	expect(response.status).toBe(204);
}

test("claim a domain: TXT and A records, then open its admin", async ({
	page,
}) => {
	const user = newUser();
	const domain = `${user.username.replace(/_/g, "-")}.example.org`;
	await signUpViaAccountPage(page, user);

	await page.goto("/claim");
	await expect(
		page.getByRole("heading", { name: "Dùng domain của riêng bạn" }),
	).toBeVisible();
	await page.locator('[data-id="input-domain"]').fill(domain);
	await page.locator('[data-id="claim-start-google"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toContainText(
		"Đã bắt đầu nhận domain",
	);
	await expect(page.locator('[data-id="claim-txt-name"]')).toHaveText(
		`_auth-claim.${domain}`,
	);
	const txt =
		(await page.locator('[data-id="claim-txt-value"]').textContent()) ?? "";

	// Checking before the records exist says what is missing.
	await page.locator('[data-id^="claim-verify-"]').click();
	await expect(page.locator('[data-id="alert-error"]')).toContainText(
		"Không thấy bản ghi TXT",
	);

	await setDns([
		[`TXT _auth-claim.${domain}`, [txt]],
		...[
			`auth.${domain}`,
			`localman.${domain}`,
			`tunnel.${domain}`,
			`*.localman.${domain}`,
			`*.tunnel.${domain}`,
		].map((host): [string, string[]] => [`A ${host}`, [E2E_SERVICE_IP]]),
	]);
	await page.locator('[data-id^="claim-verify-"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toContainText(
		"Đã nhận domain",
	);
	await expect(page.locator(`[data-id="tenant-status-${domain}"]`)).toHaveText(
		"Đã nhận: hãy thêm cách đăng nhập",
	);

	// The admin button sends the browser to the tenant's own host with a
	// one-time link (that host is not reachable here: the redirect is read).
	await page
		.context()
		.route(`https://auth.${domain}/**`, (route) => route.abort());
	const [response] = await Promise.all([
		page.waitForResponse(
			(candidate) =>
				candidate.url().includes("/claim/tenants/") &&
				candidate.request().method() === "POST",
		),
		page.locator(`[data-id="tenant-admin-${domain}"]`).click(),
	]);
	expect(response.status()).toBe(303);
	expect(response.headers().location).toMatch(
		new RegExp(
			`^https://auth\\.${domain.replace(/\./g, "\\.")}/admin/handoff\\?token=[\\w-]{43}$`,
		),
	);
});
