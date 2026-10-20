import { describe, expect, it } from "vitest";
import { shown, testPage } from "../__tests__/helpers/test-page.js";
import { brand } from "../brand.js";
import { LOCALES } from "../i18n/locales.js";
import { renderPage } from "./layout.js";

describe("renderPage head", () => {
	it.each(LOCALES)("describes the page in %s", (locale) => {
		const page = renderPage({
			title: "Title",
			body: "",
			page: testPage(locale),
		});
		expect(page).toContain(
			`<meta name="description" content="${shown("layout.description", locale)}">`,
		);
		expect(page).toContain(`<html lang="${locale}">`);
	});

	it("takes the English description from brand.config.json", () => {
		expect(testPage("en").i18n.t("layout.description")).toBe(brand.description);
	});
});
