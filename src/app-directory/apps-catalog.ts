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

/** Line icons in currentColor, 24×24, stroke width from --icon-stroke. */
const ICON_SHAPES: Readonly<Record<AppIconName, SafeHtml>> = {
	localman: html`<path d="M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1"/><circle cx="12" cy="12" r="1.5"/>`,
	mcp: html`<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/>`,
	terminal: html`<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>`,
	tunnel: html`<path d="M3 20V12a9 9 0 0 1 18 0v8M7 20v-8a5 5 0 0 1 10 0v8M3 20h18"/>`,
	chat: html`<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>`,
	scribe: html`<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>`,
	miu: html`<path d="M5 10V4l4 3h6l4-3v6a7 7 0 0 1-14 0z"/><path d="M9.5 12h.01M14.5 12h.01M10.5 15.5h3"/>`,
};

/**
 * An app's icon. `size` sets the drawn size; inside another SVG pass `x`/`y`
 * to place it (a nested <svg>).
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
	const place =
		options.x === undefined
			? ""
			: html` x="${options.x}" y="${options.y ?? 0}"`;
	return html`<svg class="icon"${place} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_SHAPES[name]}</svg>`;
}

function code(value: string): SafeHtml {
	return html`<code class="mono">${value}</code>`;
}

/**
 * The first-party apps of src/oidc/clients.ts, plus the MCP clients that
 * register themselves for Localman's MCP resource. Scribe and Miu World
 * once configured (`webApps.scribe`, `webApps.miu`).
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
