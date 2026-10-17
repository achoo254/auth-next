import { Router } from "express";
import { pageTitle } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";
import { DOMAIN_GUIDE_PATH } from "./domain-guide-link.js";
import {
	type Block,
	type Figure,
	SECTIONS,
	type Section,
} from "./domain-guide-sections.js";
import {
	SELF_HOSTED_INSTALL_GUIDE,
	SELF_HOSTED_SECTION,
} from "./domain-guide-self-hosted.js";

function imageSrc(figure: Figure, page: PageContext): string {
	return "own" in figure.image
		? `/assets/img/guide/${page.i18n.locale}/${figure.image.own}.png`
		: `/assets/img/guide/common/${figure.image.common}`;
}

function renderBlock(
	block: Block,
	page: PageContext,
	links: { readonly claim: SafeHtml; readonly installGuide: SafeHtml },
	number: () => number,
): SafeHtml {
	const { i18n } = page;
	if ("list" in block) {
		return html`<ul>${block.list.map((key) => html`<li>${i18n.t(key)}</li>`)}</ul>`;
	}
	if ("figure" in block) {
		const caption = i18n.t(block.figure.caption);
		return html`<figure class="guide-figure">
<a href="${imageSrc(block.figure, page)}"><img src="${imageSrc(block.figure, page)}" alt="${caption}" loading="lazy"></a>
<figcaption><b>${i18n.t("guide.figure", { number: String(number()) })}</b> ${caption}</figcaption>
</figure>`;
	}
	return html`<p>${i18n.rich(block.paragraph, links)}</p>`;
}

/** The steps, with the self-hosted one before the last when offered. */
function sectionsOf(selfHosted: boolean): readonly Section[] {
	if (!selfHosted) return SECTIONS;
	return [...SECTIONS.slice(0, -1), SELF_HOSTED_SECTION, ...SECTIONS.slice(-1)];
}

/** The public step-by-step guide to claiming and setting up a domain. */
export function renderDomainGuide(
	host: string,
	claimPath: string,
	page: PageContext,
	selfHosted = false,
): string {
	const { i18n } = page;
	let figures = 0;
	const number = (): number => {
		figures += 1;
		return figures;
	};
	const links = {
		claim: html`<a href="${claimPath}">${host}${claimPath}</a>`,
		installGuide: html`<a href="${SELF_HOSTED_INSTALL_GUIDE}">${i18n.t("guide.self.installGuide")}</a>`,
	};
	const title = i18n.t("guide.title");
	return renderPage({
		title,
		host,
		page,
		layout: "wide",
		body: html`${pageTitle(title, i18n.t("guide.subtitle"))}
<div class="prose guide" data-id="domain-guide">
<p>${i18n.t("guide.intro")}</p>
${sectionsOf(selfHosted).map(
	(section) => html`<section id="${section.id}" data-id="guide-${section.id}">
<h2>${i18n.t(section.title)}</h2>
${section.blocks.map((block) => renderBlock(block, page, links, number))}
</section>`,
)}
</div>`,
	});
}

/** Language-dependent like /privacy: caches must revalidate. */
export function createDomainGuideRouter(
	host: string,
	claimPath: string,
	selfHosted: boolean,
): Router {
	const router = Router();
	router.get(DOMAIN_GUIDE_PATH, (req, res) => {
		res
			.status(200)
			.set("cache-control", "private, no-cache")
			.vary("Cookie")
			.vary("Accept-Language")
			.type("html")
			.send(renderDomainGuide(host, claimPath, pageContext(req), selfHosted));
	});
	return router;
}
