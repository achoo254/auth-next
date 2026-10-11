import { Router } from "express";
import type { Env } from "../config/env.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import { RESOURCES } from "../oidc/resources.js";
import { actionLink, pageTitle } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import { type PageContext, pageContext } from "../ui/page-context.js";

export const APPS_PATH = "/apps";

/** Where the apps that sign in through this IdP live, per environment. */
export type AppDirectoryEnv = Pick<
	Env,
	"ISSUER" | "LOCALMAN_WEB_URL" | "TUNELO_WEB_URL"
>;

/** One app on the page; `id` is its `client_id` when it has a fixed one. */
interface ListedApp {
	readonly id: string;
	readonly name: string;
	readonly description: MessageKey;
	/** "How to sign in", in markup (it can name a command or an address). */
	readonly signIn: SafeHtml;
	/** Web apps get an "Open" button; CLI and MCP have nothing to open. */
	readonly href?: string;
}

function code(value: string): SafeHtml {
	return html`<code class="mono">${value}</code>`;
}

/**
 * The first-party apps of src/oidc/clients.ts, plus the MCP clients that
 * register themselves for Localman's MCP resource.
 */
function listedApps(env: AppDirectoryEnv, i18n: Translator): ListedApp[] {
	const deviceUrl = new URL(OIDC_ROUTES.code_verification, env.ISSUER).href;
	return [
		{
			id: STATIC_CLIENT_IDS.localmanWeb,
			name: "Localman",
			description: "apps.localmanWeb.description",
			signIn: html`${i18n.t("apps.localmanWeb.signIn")}`,
			href: env.LOCALMAN_WEB_URL,
		},
		{
			id: "localman-mcp",
			name: "Localman MCP",
			description: "apps.localmanMcp.description",
			signIn: i18n.rich("apps.localmanMcp.signIn", {
				address: code(RESOURCES.localmanMcp),
			}),
		},
		{
			id: STATIC_CLIENT_IDS.tuneloCli,
			name: "Tunelo CLI",
			description: "apps.tuneloCli.description",
			signIn: i18n.rich("apps.tuneloCli.signIn", {
				command: code("tunelo login"),
				device: html`<a class="link" href="${deviceUrl}">${deviceUrl}</a>`,
			}),
		},
		{
			id: STATIC_CLIENT_IDS.tuneloWeb,
			name: "Tunelo",
			description: "apps.tuneloWeb.description",
			signIn: html`${i18n.t("apps.tuneloWeb.signIn")}`,
			href: env.TUNELO_WEB_URL,
		},
	];
}

function appRow(app: ListedApp, i18n: Translator): SafeHtml {
	return html`<li class="item-row" data-id="app-${app.id}"><div>
<b>${app.name}</b>${app.href ? html` <span class="help mono">${new URL(app.href).host}</span>` : ""}
<p class="help">${i18n.t(app.description)}</p>
<p class="help">${app.signIn}</p></div>
${app.href ? actionLink(app.href, i18n.t("apps.open"), { dataId: `app-open-${app.id}` }) : ""}
</li>`;
}

export function renderAppsPage(
	env: AppDirectoryEnv,
	page: PageContext,
): string {
	const { i18n } = page;
	const title = i18n.t("apps.title");
	return renderPage({
		title,
		host: new URL(env.ISSUER).host,
		page,
		layout: "wide",
		body: html`${pageTitle(title, i18n.t("apps.subtitle"))}
<ul class="item-list" data-id="app-list">${listedApps(env, i18n).map((app) => appRow(app, i18n))}</ul>
<p class="help" data-id="apps-manage">${i18n.rich("apps.manage", { account: html`<a class="link" href="/account">${i18n.t("layout.brand")}</a>` })}</p>`,
	});
}

/**
 * Public, no session. `/` sends people who type the bare domain here.
 * Like /privacy, the page follows the visitor's language, so caches must
 * revalidate rather than serve one language to everyone.
 */
export function createAppsRouter(env: AppDirectoryEnv): Router {
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
			.send(renderAppsPage(env, pageContext(req)));
	});
	return router;
}
