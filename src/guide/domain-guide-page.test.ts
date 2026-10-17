import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { testPage } from "../__tests__/helpers/test-page.js";
import { LOCALES } from "../i18n/locales.js";
import { renderDomainGuide } from "./domain-guide-page.js";
import { SELF_HOSTED_INSTALL_GUIDE } from "./domain-guide-self-hosted.js";

const STATIC = "static";

function imageSources(page: string): string[] {
	return [...page.matchAll(/<img src="([^"]+)"/g)].map(
		(match) => match[1] ?? "",
	);
}

describe("/guide/domain", () => {
	it.each(LOCALES)("shows screenshots that exist, in %s", (locale) => {
		const page = renderDomainGuide(
			"auth.example.test",
			"/claim",
			testPage(locale),
		);
		const sources = imageSources(page);
		expect(sources.length).toBeGreaterThanOrEqual(14);
		for (const source of sources) {
			expect(source).toMatch(/^\/assets\/img\/guide\//);
			expect(existsSync(`${STATIC}${source.replace("/assets", "")}`)).toBe(
				true,
			);
		}
		// This service's own pages are shown in the reader's language.
		expect(sources).toContain(`/assets/img/guide/${locale}/claim-records.png`);
	});

	it("links the claim page and numbers every figure", () => {
		const page = renderDomainGuide(
			"auth.example.test",
			"/claim",
			testPage("en"),
		);
		expect(page).toContain('<a href="/claim">auth.example.test/claim</a>');
		const figures = [...page.matchAll(/Figure (\d+)\./g)].map(
			(match) => match[1],
		);
		expect(figures).toEqual(figures.map((_, index) => String(index + 1)));
	});

	it("explains running on your own server only where /claim offers it", () => {
		const hosted = renderDomainGuide(
			"auth.example.test",
			"/claim",
			testPage("en"),
		);
		expect(hosted).not.toContain('id="self-hosted"');
		const page = renderDomainGuide(
			"auth.example.test",
			"/claim",
			testPage("en"),
			true,
		);
		expect(page).toContain('id="self-hosted"');
		expect(page).toContain(`href="${SELF_HOSTED_INSTALL_GUIDE}"`);
		// Before keeping or removing the domain, the last step.
		expect(page.indexOf('id="self-hosted"')).toBeLessThan(
			page.indexOf('id="keep"'),
		);
	});
});
