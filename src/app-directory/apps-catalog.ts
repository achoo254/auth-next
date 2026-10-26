import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { STATIC_CLIENT_IDS } from "../oidc/clients.js";
import { OIDC_ROUTES } from "../oidc/provider.js";
import { resourcesFor } from "../tenants/tenant-resources.js";
import type { Tenant } from "../tenants/tenant.js";
import { type SafeHtml, html } from "../ui/html.js";

/** Where the apps that sign in through this IdP live: the tenant's. */
export type AppDirectoryTenant = Pick<Tenant, "issuer" | "domain" | "webApps">;

/** One palette hue per app, from the data-viz tokens (apps.css). */
export type AppTone = "violet" | "cyan" | "green" | "amber" | "blue" | "red";

type AppIconName =
	| "localman"
	| "mcp"
	| "terminal"
	| "tunnel"
	| "chat"
	| "scribe"
	| "miu";

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

/**
 * The AI-drawn app marks (rounded, transparent corners), served from
 * static/img/apps through /assets/img. Tunelo's web app uses the tunnel mark.
 */
const ICON_FILES: Readonly<Record<AppIconName, string>> = {
	localman: "localman-mark-128.webp",
	mcp: "mcp-mark-128.webp",
	terminal: "terminal-mark-128.webp",
	tunnel: "tunelo-mark-128.webp",
	chat: "chat-mark-128.webp",
	scribe: "scribe-mark-128.webp",
	miu: "miu-mark-128.webp",
};

/**
 * An app's mark, decorative (the app's name is always beside it). `size`
 * sets the drawn size; inside an SVG pass `x`/`y` to place it (an <image>).
 */
export function appIcon(
	name: AppIconName,
	options: {
		readonly size?: number;
		readonly x?: number;
		readonly y?: number;
	} = {},
): SafeHtml {
	const size = options.size ?? 22;
	const src = `/assets/img/apps/${ICON_FILES[name]}`;
	if (options.x !== undefined) {
		return html`<image href="${src}" x="${options.x}" y="${options.y ?? 0}" width="${size}" height="${size}" aria-hidden="true"/>`;
	}
	return html`<img class="app-mark" src="${src}" width="${size}" height="${size}" alt="">`;
}

function code(value: string): SafeHtml {
	return html`<code class="mono">${value}</code>`;
}

/**
 * The first-party apps of src/oidc/clients.ts, plus the MCP clients that
 * register themselves for the MCP resources of Localman and Chat. Scribe
 * and Miu World once configured (`webApps.scribe`, `webApps.miu`).
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
		...(tenant.webApps.scribe ? [scribeWeb(tenant.webApps.scribe, i18n)] : []),
		...(tenant.webApps.miu ? [miuWeb(tenant.webApps.miu, i18n)] : []),
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

function scribeWeb(href: string, i18n: Translator): ListedApp {
	return {
		id: STATIC_CLIENT_IDS.scribeWeb,
		name: "Scribe",
		tone: "red",
		icon: "scribe",
		kind: "apps.kind.web",
		description: "apps.scribeWeb.description",
		signIn: html`${i18n.t("apps.scribeWeb.signIn")}`,
		href,
	};
}

function miuWeb(href: string, i18n: Translator): ListedApp {
	return {
		id: STATIC_CLIENT_IDS.miuWeb,
		name: "Miu World",
		tone: "cyan",
		icon: "miu",
		kind: "apps.kind.web",
		description: "apps.miuWeb.description",
		signIn: html`${i18n.t("apps.miuWeb.signIn")}`,
		href,
	};
}
