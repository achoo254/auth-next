import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import { resourcesFor } from "../tenants/tenant-resources.js";
import type { Tenant } from "../tenants/tenant.js";
import { type SafeHtml, html } from "../ui/html.js";
import type { AppIconName } from "./app-marks.js";

/** Where the apps that sign in through this IdP live: the tenant's. */
export type AppDirectoryTenant = Pick<Tenant, "issuer" | "domain" | "webApps">;

/** One palette hue per app, from the data-viz tokens (apps.css). */
export type AppTone = "violet" | "cyan" | "green" | "amber" | "blue" | "red";

/** One app on the page; `id` is its `client_id` when it has a fixed one. */
export interface ListedApp {
	readonly id: string;
	readonly name: string;
	readonly tone: AppTone;
	readonly icon: AppIconName;
	readonly kind: MessageKey;
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
 * register themselves for the MCP resources of Localman and Chat, and the
 * web apps of OPTIONAL_WEB_APPS once configured.
 */
export function listedApps(
	tenant: AppDirectoryTenant,
	i18n: Translator,
): ListedApp[] {
	const deviceUrl = new URL(OIDC_ROUTES.code_verification, tenant.issuer).href;
	return [
		{
			id: STATIC_CLIENT_IDS.localmanWeb,
			name: "Localman",
			tone: "violet",
			icon: "localman",
			kind: "apps.kind.web",
			description: "apps.localmanWeb.description",
			signIn: html`${i18n.t("apps.localmanWeb.signIn")}`,
			href: tenant.webApps.localman,
		},
		{
			id: "localman-mcp",
			name: "Localman MCP",
			tone: "cyan",
			icon: "mcp",
			kind: "apps.kind.mcp",
			description: "apps.localmanMcp.description",
			signIn: i18n.rich("apps.localmanMcp.signIn", {
				address: code(resourcesFor(tenant.domain).localmanMcp),
			}),
		},
		{
			id: STATIC_CLIENT_IDS.tuneloCli,
			name: "Tunelo CLI",
			tone: "green",
			icon: "terminal",
			kind: "apps.kind.cli",
			description: "apps.tuneloCli.description",
			signIn: i18n.rich("apps.tuneloCli.signIn", {
				command: code("tunelo login"),
				device: html`<a class="link" href="${deviceUrl}">${deviceUrl}</a>`,
			}),
		},
		{
			id: STATIC_CLIENT_IDS.tuneloWeb,
			name: "Tunelo",
			tone: "amber",
			icon: "tunnel",
			kind: "apps.kind.web",
			description: "apps.tuneloWeb.description",
			signIn: html`${i18n.t("apps.tuneloWeb.signIn")}`,
			href: tenant.webApps.tunelo,
		},
		chatWeb(tenant, i18n),
		chatMcp(tenant, i18n),
		...OPTIONAL_WEB_APPS.flatMap((app) => {
			const href = tenant.webApps[app.key];
			return href ? [optionalWebApp(app, href, i18n)] : [];
		}),
	];
}

function chatWeb(tenant: AppDirectoryTenant, i18n: Translator): ListedApp {
	return {
		id: STATIC_CLIENT_IDS.chatWeb,
		name: "Chat",
		tone: "blue",
		icon: "chat",
		kind: "apps.kind.web",
		description: "apps.chatWeb.description",
		signIn: html`${i18n.t("apps.chatWeb.signIn")}`,
		href: tenant.webApps.chat,
	};
}

function chatMcp(tenant: AppDirectoryTenant, i18n: Translator): ListedApp {
	return {
		id: "chat-mcp",
		name: "Chat MCP",
		tone: "blue",
		icon: "mcp",
		kind: "apps.kind.mcp",
		description: "apps.chatMcp.description",
		signIn: i18n.rich("apps.chatMcp.signIn", {
			address: code(resourcesFor(tenant.domain).chatMcp),
		}),
	};
}

/**
 * Web apps listed only once their client is configured (their `webApps`
 * entry is set from the environment): Scribe, Miu World, Tiểu Đệ.
 */
const OPTIONAL_WEB_APPS = [
	{
		key: "scribe",
		id: STATIC_CLIENT_IDS.scribeWeb,
		name: "Scribe",
		tone: "red",
		icon: "scribe",
		description: "apps.scribeWeb.description",
		signIn: "apps.scribeWeb.signIn",
	},
	{
		key: "miu",
		id: STATIC_CLIENT_IDS.miuWeb,
		name: "Miu World",
		tone: "cyan",
		icon: "miu",
		description: "apps.miuWeb.description",
		signIn: "apps.miuWeb.signIn",
	},
	{
		key: "tieude",
		id: STATIC_CLIENT_IDS.tieudeWeb,
		name: "Tiểu Đệ",
		tone: "amber",
		icon: "tieude",
		description: "apps.tieudeWeb.description",
		signIn: "apps.tieudeWeb.signIn",
	},
] as const satisfies readonly {
	readonly key: "scribe" | "miu" | "tieude";
	readonly id: string;
	readonly name: string;
	readonly tone: AppTone;
	readonly icon: AppIconName;
	readonly description: MessageKey;
	readonly signIn: MessageKey;
}[];

function optionalWebApp(
	app: (typeof OPTIONAL_WEB_APPS)[number],
	href: string,
	i18n: Translator,
): ListedApp {
	return {
		id: app.id,
		name: app.name,
		tone: app.tone,
		icon: app.icon,
		kind: "apps.kind.web",
		description: app.description,
		signIn: html`${i18n.t(app.signIn)}`,
		href,
	};
}
