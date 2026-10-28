import { expect, test } from "@playwright/test";

test.use({ locale: "en-US" });

test("the footer's theme switch runs from its script file under the page's CSP", async ({
	page,
	context,
}) => {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(String(error)));

	await page.goto("/apps");
	const html = page.locator("html");
	await expect(html).not.toHaveAttribute("data-theme", /./);
	await expect(page.locator('[data-id="theme-system"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);

	await page.locator('[data-id="theme-dark"]').click();
	await expect(html).toHaveAttribute("data-theme", "dark");
	await expect(page.locator('[data-id="theme-dark"]')).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	const cookies = await context.cookies();
	expect(cookies.find((cookie) => cookie.name === "hd_theme")?.value).toBe(
		"dark",
	);

	// The choice is applied before the next page paints, on every page.
	await page.goto("/privacy");
	await expect(html).toHaveAttribute("data-theme", "dark");
	await page.locator('[data-id="theme-light"]').click();
	await expect(html).toHaveAttribute("data-theme", "light");
	expect(errors).toEqual([]);

	// An inline script is still refused.
	const ran = await page.evaluate(async () => {
		const refused = new Promise<string>((resolve) => {
			document.addEventListener(
				"securitypolicyviolation",
				(event) => resolve(event.effectiveDirective),
				{ once: true },
			);
		});
		const script = document.createElement("script");
		script.textContent = "document.documentElement.dataset.inline = 'ran'";
		document.head.append(script);
		return {
			directive: await refused,
			inline: document.documentElement.dataset.inline ?? null,
		};
	});
	expect(ran).toEqual({ directive: "script-src-elem", inline: null });
});
