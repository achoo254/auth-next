import { mkdirSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { type BrowserContext, type Page, expect, test } from "@playwright/test";
import {
	E2E_ISSUER,
	E2E_SERVICE_IP,
	E2E_TOOLS,
} from "../support/e2e-config.js";
import { type TestUser, signUpViaAccountPage } from "../support/flows.js";

/** The sample domain every screenshot shows. */
const DOMAIN = "example.org";
const OUT = "static/img/guide";
const LANGUAGES = ["vi", "en", "zh-CN"] as const;
type Language = (typeof LANGUAGES)[number];

async function setDns(entries: readonly [string, string[]][]): Promise<void> {
	const response = await fetch(`${E2E_TOOLS}/dns`, {
		method: "POST",
		body: JSON.stringify(entries),
	});
	expect(response.status).toBe(204);
}

function addressRecords(ip: string): [string, string[]][] {
	return [
		`auth.${DOMAIN}`,
		`chat.${DOMAIN}`,
		`localman.${DOMAIN}`,
		`tunnel.${DOMAIN}`,
		`*.localman.${DOMAIN}`,
		`*.tunnel.${DOMAIN}`,
	].map((host): [string, string[]] => [`A ${host}`, [ip]]);
}

/** One request to the test server as if it came for `host` (Node keeps the Host header). */
function forward(
	method: string,
	path: string,
	headers: Record<string, string>,
	body: Buffer | null,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
	const target = new URL(E2E_ISSUER);
	return new Promise((resolve, reject) => {
		const request = httpRequest(
			{ host: target.hostname, port: target.port, method, path, headers },
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const out: Record<string, string> = {};
					for (const [name, value] of Object.entries(response.headers)) {
						if (value !== undefined)
							out[name] = Array.isArray(value) ? value.join("\n") : value;
					}
					resolve({
						status: response.statusCode ?? 502,
						headers: out,
						body: Buffer.concat(chunks),
					});
				});
			},
		);
		request.on("error", reject);
		if (body) request.write(body);
		request.end();
	});
}

/**
 * The tenant's own host (https://auth.<domain>) is served by the same test
 * server: requests are passed to it with the tenant's Host header, so the
 * browser sees the real /admin of the tenant.
 */
async function routeTenantHost(context: BrowserContext): Promise<void> {
	await context.route(`https://auth.${DOMAIN}/**`, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const response = await forward(
			request.method(),
			`${url.pathname}${url.search}`,
			{
				...(await request.allHeaders()),
				host: `auth.${DOMAIN}`,
				"x-forwarded-proto": "https",
			},
			request.postDataBuffer(),
		);
		const location = response.headers.location;
		if (response.status >= 300 && response.status < 400 && location) {
			// A redirect target cannot be routed; a page that navigates can.
			const {
				location: _,
				"content-length": __,
				...headers
			} = response.headers;
			await route.fulfill({
				status: 200,
				headers: { ...headers, "content-type": "text/html; charset=utf-8" },
				body: `<meta http-equiv="refresh" content="0;url=${new URL(location, url).href}">`,
			});
			return;
		}
		await route.fulfill(response);
	});
}

async function useLanguage(context: BrowserContext, language: Language) {
	await context.addCookies(
		[new URL(E2E_ISSUER).hostname, `auth.${DOMAIN}`].map((domain) => ({
			name: "hd_lang",
			value: language,
			domain,
			path: "/",
		})),
	);
}

/**
 * What the page shows that must not be published as is: the test server's
 * host (production shows its own) and the claim's TXT value, a per-claim
 * proof a reader must never copy from a picture.
 */
async function prepareForGuide(page: Page): Promise<void> {
	await page.evaluate((testHost) => {
		for (const badge of document.querySelectorAll(".topbar .badge")) {
			if (badge.textContent === testHost)
				badge.textContent = "auth.hoandat.com";
		}
		for (const value of document.querySelectorAll(
			'[data-id="claim-txt-value"]',
		)) {
			value.textContent = (value.textContent ?? "").replace(
				/=.*$/,
				"=••••••••",
			);
		}
	}, new URL(E2E_ISSUER).host);
}

/** One card of the page. */
async function shot(
	page: Page,
	language: Language,
	name: string,
	selector: string,
): Promise<void> {
	await prepareForGuide(page);
	await page
		.locator(selector)
		.first()
		.screenshot({
			path: `${OUT}/${language}/${name}.png`,
			animations: "disabled",
		});
}

/** Page offset of an element's top and bottom edges. */
async function edges(
	page: Page,
	selector: string,
): Promise<{ top: number; bottom: number }> {
	return page
		.locator(selector)
		.first()
		.evaluate((element) => {
			const box = element.getBoundingClientRect();
			return {
				top: box.top + window.scrollY,
				bottom: box.bottom + window.scrollY,
			};
		});
}

/**
 * A band of the page across its full width: from the top of `from` (or the
 * page top) to the bottom of `to`, or to just above it when `above`.
 */
async function band(
	page: Page,
	language: Language,
	name: string,
	region: { from?: string; to: string; above?: boolean },
): Promise<void> {
	await prepareForGuide(page);
	const top = region.from ? (await edges(page, region.from)).top - 16 : 0;
	const end = await edges(page, region.to);
	const bottom = region.above ? end.top - 8 : end.bottom + 16;
	const width = page.viewportSize()?.width ?? 1100;
	await page.screenshot({
		path: `${OUT}/${language}/${name}.png`,
		fullPage: true,
		animations: "disabled",
		clip: {
			x: 0,
			y: Math.max(0, top),
			width,
			height: bottom - Math.max(0, top),
		},
	});
}

const owner: TestUser = {
	email: "owner@example.org",
	username: "example_owner",
	googleId: "g-guide-owner",
};

test("guide screenshots of /claim and /admin", async ({ page }) => {
	for (const language of LANGUAGES)
		mkdirSync(`${OUT}/${language}`, { recursive: true });
	await page.setViewportSize({ width: 1100, height: 900 });
	await routeTenantHost(page.context());
	await signUpViaAccountPage(page, owner);

	// One claim, shown in every language before it is verified.
	await page.goto("/claim");
	await page.locator('[data-id="input-domain"]').fill(DOMAIN);
	await page.locator('[data-id="claim-start-google"]').click();
	await expect(page.locator('[data-id="claim-txt-value"]')).toBeVisible();
	const txt =
		(await page.locator('[data-id="claim-txt-value"]').textContent()) ?? "";

	for (const language of LANGUAGES) {
		await useLanguage(page.context(), language);
		await page.goto("/claim");
		await shot(
			page,
			language,
			"claim-start",
			'[data-id="account-claim-start"]',
		);
		await shot(
			page,
			language,
			"claim-records",
			'[data-id="account-claim-pending"]',
		);
	}

	// Every record but one right: the page marks the one to fix.
	await setDns([
		[`TXT _auth-claim.${DOMAIN}`, [txt]],
		...addressRecords(E2E_SERVICE_IP),
		[`A chat.${DOMAIN}`, ["198.51.100.7"]],
	]);
	await useLanguage(page.context(), "vi");
	await page.goto("/claim");
	await page.locator('[data-id^="claim-verify-"]').click();
	await expect(page.locator('[data-id="alert-error"]')).toBeVisible();
	const wrongUrl = page.url();
	for (const language of LANGUAGES) {
		await useLanguage(page.context(), language);
		await page.goto(wrongUrl);
		await band(page, language, "claim-wrong", {
			from: '[data-id="alert-error"]',
			to: '[data-id="account-claim-pending"]',
		});
	}

	await setDns(addressRecords(E2E_SERVICE_IP));
	await useLanguage(page.context(), "vi");
	await page.goto("/claim");
	await page.locator('[data-id^="claim-verify-"]').click();
	await expect(page.locator('[data-id="alert-success"]')).toBeVisible();
	for (const language of LANGUAGES) {
		await useLanguage(page.context(), language);
		await page.goto("/claim");
		await shot(
			page,
			language,
			"claim-tenants",
			'[data-id="account-claim-tenants"]',
		);
	}

	// The admin link sends the browser to the tenant's own host; Playwright
	// cannot route a redirect target, so the one-time link is opened directly.
	await page.context().route("**/claim/tenants/*/admin", async (route) => {
		const response = await route.fetch({ maxRedirects: 0 });
		await route.fulfill({
			status: 200,
			contentType: "text/plain",
			body: response.headers().location ?? "",
		});
	});
	await page.locator(`[data-id="tenant-admin-${DOMAIN}"]`).click();
	const handoff = (await page.locator("body").textContent()) ?? "";
	expect(handoff).toContain(`https://auth.${DOMAIN}/admin/handoff`);
	await page.goto(handoff);
	await page.waitForURL(`https://auth.${DOMAIN}/admin`);
	await expect(page.locator('[data-id="account-admin-dns"]')).toBeVisible();
	for (const language of LANGUAGES) {
		await useLanguage(page.context(), language);
		await page.goto(`https://auth.${DOMAIN}/admin`);
		await band(page, language, "admin-overview", {
			to: '[data-id="account-admin-domain"]',
		});
		await shot(
			page,
			language,
			"admin-oauth",
			'[data-id="account-admin-github"]',
		);
		await shot(page, language, "admin-dns", '[data-id="account-admin-dns"]');
	}
});
