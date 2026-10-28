import { Router } from "express";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { actionLink } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";
import { appIcon } from "./app-marks.js";
import {
	type AppDirectoryTenant,
	type ListedApp,
	listedApps,
} from "./apps-catalog.js";
import { hubDiagram } from "./apps-illustration.js";

export type { AppDirectoryTenant } from "./apps-catalog.js";

export const APPS_PATH = "/apps";
const STEPS_ANCHOR = "how-sign-in-works";

const TRUST: readonly MessageKey[] = [
	"apps.trust.providers",
	"apps.trust.noPassword",
	"apps.trust.control",
];

const CHECK = html`<svg class="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l4 4 10-10"/></svg>`;

/**
 * The directory showcases apps with a web page of their own; Localman MCP,
 * Chat MCP and Tunelo CLI are other ways into those apps, explained on their
 * sites, and the sign-in steps below still name `tunelo login`.
 */
const hasHomePage = (app: ListedApp): boolean => app.kind === "apps.kind.web";

/** Apps for fun; every other app is listed under work. */
const FUN_APP_IDS: ReadonlySet<string> = new Set([
	STATIC_CLIENT_IDS.miuWeb,
	STATIC_CLIENT_IDS.tieudeWeb,
	STATIC_CLIENT_IDS.tuviWeb,
	STATIC_CLIENT_IDS.clipWeb,
]);
const isFunApp = (app: ListedApp): boolean => FUN_APP_IDS.has(app.id);

/**
 * The diagram draws the main work apps only: Localman MCP and Tunelo CLI are
 * other ways into Localman and Tunelo, listed below with how to sign in, and
 * apps for fun have their own group in the list.
 */
const isMainApp = (app: ListedApp): boolean =>
	app.kind === "apps.kind.web" && !isFunApp(app);

const GROUPS = [
	{
		key: "work",
		title: "apps.group.work.title",
		lead: "apps.group.work.lead",
		fun: false,
	},
	{
		key: "fun",
		title: "apps.group.fun.title",
		lead: "apps.group.fun.lead",
		fun: true,
	},
] as const satisfies readonly {
	key: string;
	title: MessageKey;
	lead: MessageKey;
	fun: boolean;
}[];

function appGroups(apps: readonly ListedApp[], i18n: Translator): SafeHtml {
	return html`${GROUPS.map((group) => {
		const members = apps.filter((app) => isFunApp(app) === group.fun);
		if (members.length === 0) return html``;
		return html`<section class="apps-section apps-group" aria-labelledby="apps-group-${group.key}" data-id="apps-group-${group.key}">
<div class="apps-group-head"><h2 class="apps-group-title" id="apps-group-${group.key}">${i18n.t(group.title)}</h2><p class="apps-group-lead">${i18n.t(group.lead)}</p></div>
<ul class="apps-grid" data-id="app-list-${group.key}">${members.map((app) => appCard(app, i18n))}</ul>
</section>`;
	})}`;
}

function hero(
	tenant: AppDirectoryTenant,
	i18n: Translator,
	apps: readonly ListedApp[],
): SafeHtml {
	return html`<section class="apps-hero" data-id="apps-hero">
<div class="apps-hero-text">
<p class="apps-eyebrow">${i18n.t("apps.eyebrow")}</p>
<h1 class="apps-title">${i18n.t("apps.title")}</h1>
<p class="apps-lead">${i18n.t("apps.subtitle")}</p>
<ul class="apps-trust">${TRUST.map((key) => html`<li>${CHECK}<span>${i18n.t(key)}</span></li>`)}</ul>
<div class="apps-actions">
<a class="btn btn-primary" href="/account" data-id="apps-manage-account">${i18n.t("apps.cta.account")}</a>
<a class="btn btn-secondary" href="#${STEPS_ANCHOR}" data-id="apps-how">${i18n.t("apps.cta.how")}</a>
</div>
</div>
<div class="apps-hero-art">${hubDiagram(i18n, apps.filter(isMainApp), new URL(tenant.issuer).host)}</div>
</section>`;
}

function appCard(app: ListedApp, i18n: Translator): SafeHtml {
	return html`<li class="app-card tone-${app.tone}" data-id="app-${app.id}">
<div class="app-card-head">
<span class="app-card-icon">${appIcon(app.icon, { size: 44 })}</span>
<div class="app-card-heading"><h3 class="app-card-name">${app.name}</h3>
<p class="app-card-meta"><span class="badge badge-neutral">${i18n.t(app.kind)}</span>${app.href ? html`<span class="mono">${new URL(app.href).host}</span>` : ""}</p></div>
</div>
<p class="app-card-desc">${i18n.t(app.description)}</p>
<div class="app-card-how"><p class="app-card-how-label">${i18n.t("apps.signInLabel")}</p><p>${app.signIn}</p></div>
${app.href ? html`<div class="app-card-foot">${actionLink(app.href, i18n.t("apps.open"), { dataId: `app-open-${app.id}` })}</div>` : ""}
</li>`;
}

function steps(i18n: Translator): SafeHtml {
	const items: readonly [MessageKey, SafeHtml][] = [
		[
			"apps.steps.choose.title",
			i18n.rich("apps.steps.choose.body", {
				command: html`<code class="mono">tunelo login</code>`,
			}),
		],
		["apps.steps.provider.title", html`${i18n.t("apps.steps.provider.body")}`],
		["apps.steps.back.title", html`${i18n.t("apps.steps.back.body")}`],
	];
	return html`<section class="apps-section" id="${STEPS_ANCHOR}" aria-labelledby="apps-steps-title" data-id="apps-steps">
<h2 class="apps-section-title" id="apps-steps-title">${i18n.t("apps.steps.title")}</h2>
<ol class="apps-steps">${items.map(
		([title, body], index) =>
			html`<li class="apps-step"><span class="apps-step-number" aria-hidden="true">${index + 1}</span><div><h3 class="apps-step-title">${i18n.t(title)}</h3><p class="apps-step-body">${body}</p></div></li>`,
	)}</ol>
</section>`;
}

export function renderAppsPage(
	tenant: AppDirectoryTenant,
	page: PageContext,
): string {
	const { i18n } = page;
	const apps = listedApps(tenant, i18n);
	return renderPage({
		title: i18n.t("apps.title"),
		page,
		layout: "portal",
		stylesheets: ["apps.css"],
		body: html`${hero(tenant, i18n, apps)}
${appGroups(apps.filter(hasHomePage), i18n)}
${steps(i18n)}
<p class="apps-manage" data-id="apps-manage">${i18n.rich("apps.manage", { account: html`<a class="link" href="/account">${i18n.t("layout.brand")}</a>` })}</p>`,
	});
}

/**
 * Public, no session. `/` sends people who type the bare domain here.
 * Like /privacy, the page follows the visitor's language, so caches must
 * revalidate rather than serve one language to everyone.
 */
export function createAppsRouter(tenant: AppDirectoryTenant): Router {
	const router = Router();
	router.get("/", (_req, res) => {
		res.redirect(302, APPS_PATH);
	});
	router.get(APPS_PATH, (req, res) => {
		res
			.status(200)
			.set("cache-control", "private, no-cache")
			.vary("Cookie")
			.vary("Accept-Language")
			.type("html")
			.send(renderAppsPage(tenant, pageContext(req)));
	});
	return router;
}
