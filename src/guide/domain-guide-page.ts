import { Router } from "express";
import { pageTitle } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";
import { type Block, type Figure, SECTIONS } from "./domain-guide-sections.js";

export const DOMAIN_GUIDE_PATH = "/guide/domain";

function imageSrc(figure: Figure, page: PageContext): string {
	return "own" in figure.image
		? `/assets/img/guide/${page.i18n.locale}/${figure.image.own}.png`
		: `/assets/img/guide/common/${figure.image.common}`;
}

function renderBlock(
	block: Block,
	page: PageContext,
	claim: SafeHtml,
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
	return html`<p>${i18n.rich(block.paragraph, { claim })}</p>`;
}

/** The public step-by-step guide to claiming and setting up a domain. */
export function renderDomainGuide(
	host: string,
	claimPath: string,
	page: PageContext,
): string {
	const { i18n } = page;
	let figures = 0;
	const number = (): number => {
		figures += 1;
		return figures;
	};
	const claim = html`<a href="${claimPath}">${host}${claimPath}</a>`;
	const title = i18n.t("guide.title");
	return renderPage({
		title,
		host,
		page,
		layout: "wide",
		body: html`${pageTitle(title, i18n.t("guide.subtitle"))}
<div class="prose guide" data-id="domain-guide">
<p>${i18n.t("guide.intro")}</p>
${SECTIONS.map(
	(section) => html`<section id="${section.id}" data-id="guide-${section.id}">
<h2>${i18n.t(section.title)}</h2>
${section.blocks.map((block) => renderBlock(block, page, claim, number))}
</section>`,
)}
</div>`,
	});
}

/** Language-dependent like /privacy: caches must revalidate. */
export function createDomainGuideRouter(
	host: string,
	claimPath: string,
): Router {
	const router = Router();
	router.get(DOMAIN_GUIDE_PATH, (req, res) => {
		res
			.status(200)
			.set("cache-control", "private, no-cache")
			.vary("Cookie")
			.vary("Accept-Language")
			.type("html")
			.send(renderDomainGuide(host, claimPath, pageContext(req)));
	});
	return router;
}
