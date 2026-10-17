import { readFile } from "node:fs/promises";
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
			`chat.${domain}`,
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

test("claim a domain to host it yourself: TXT only, then wait for the install", async ({
	page,
}) => {
	const user = newUser();
	const domain = `${user.username.replace(/_/g, "-")}-own.example.org`;
	await signUpViaAccountPage(page, user);

	await page.goto("/claim");
	await page.locator('[data-id="input-domain"]').fill(domain);
	await page.locator('[data-id="claim-hosting-self"]').check();
	await page.locator('[data-id="claim-start-google"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toContainText(
		"Đã bắt đầu nhận domain",
	);
	// Only the TXT record: the hosts will point at the owner's servers.
	await expect(page.locator('[data-id="claim-record-auth"]')).toHaveCount(0);
	const txt =
		(await page.locator('[data-id="claim-txt-value"]').textContent()) ?? "";
	await setDns([[`TXT _auth-claim.${domain}`, [txt]]]);
	await page.locator('[data-id^="claim-verify-"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toContainText(
		"Đã xác minh domain",
	);
	await expect(
		page.locator(`[data-id="tenant-status-${domain}"]`),
	).toContainText("chờ bản cài");
	await expect(page.locator(`[data-id="tenant-admin-${domain}"]`)).toHaveCount(
		0,
	);

	// The owner downloads the bundle their install redeems: a signed JWT
	// for https://auth.<domain>, with no secret in it.
	const download = page.waitForEvent("download");
	await page.locator(`[data-id="tenant-bundle-${domain}"]`).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe(`enrollment-${domain}.jwt`);
	const bundle = (await readFile(await file.path(), "utf8")).trim();
	const [header = "", payload = ""] = bundle.split(".");
	expect(JSON.parse(Buffer.from(header, "base64url").toString())).toMatchObject(
		{ alg: "ES256", typ: "hoandat-enrollment+jwt" },
	);
	expect(
		JSON.parse(Buffer.from(payload, "base64url").toString()),
	).toMatchObject({ aud: `https://auth.${domain}`, domain });
	expect(bundle).not.toContain(txt);

	// Redemption is server to server, JSON, no cookie: refused before any
	// call to the domain when the bundle or the key is not acceptable.
	const redeem = (data: unknown) =>
		page.request.post("/claim/enrollments", {
			data,
			headers: { cookie: "" },
		});
	const empty = await redeem({});
	expect(empty.status()).toBe(400);
	expect(await empty.json()).toEqual({ error: "invalid-bundle" });
	const privateKey = await redeem({
		bundle,
		install_key: {
			kty: "EC",
			crv: "P-256",
			x: "a".repeat(43),
			y: "b".repeat(43),
			d: "c".repeat(43),
		},
	});
	expect(privateKey.status()).toBe(400);
	expect(await privateKey.json()).toEqual({ error: "invalid-key" });
});
