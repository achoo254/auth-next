import type { Translator } from "../i18n/translator.js";
import {
	CHAT_MCP_SCOPES,
	LOCALMAN_MCP_SCOPES,
	TUNELO_AGENT_CLIENT_ID,
	TUNNEL_SCOPES,
} from "../oidc/resources.js";
import { alertBox } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { describeScopes } from "./consent-page.js";

/** The apps a machine agent acts in, each with the scopes that belong to it. */
const APPS: readonly {
	readonly id: string;
	readonly name: string;
	readonly scopes: readonly string[];
}[] = [
	{ id: "tunelo", name: "Tunelo", scopes: TUNNEL_SCOPES },
	{ id: "chat", name: "Chat", scopes: CHAT_MCP_SCOPES },
	{ id: "localman", name: "Localman", scopes: LOCALMAN_MCP_SCOPES },
];

const APP_SCOPES: ReadonlySet<string> = new Set(
	APPS.flatMap((app) => app.scopes),
);

/**
 * Whether the approval page lists access app by app and warns: the Tunelo
 * agent gets one grant for tunnels, Chat and Localman, so approving a code
 * someone else started would hand them all three.
 */
export function approvalListsApps(clientId: string): boolean {
	return clientId === TUNELO_AGENT_CLIENT_ID;
}

function scopeList(
	i18n: Translator,
	scopes: readonly string[],
	dataId: string,
): SafeHtml {
	return html`<ul class="scope-list" data-id="${dataId}">${describeScopes(i18n, scopes).map((text) => html`<li>${text}</li>`)}</ul>`;
}

/**
 * What the agent asks for: account-wide access first (sign-in, staying
 * signed in, adding the machine), then what it may do in each app, then the
 * warning to approve only a command the user just ran on their own machine.
 */
export function appAccessBlock(
	i18n: Translator,
	scopes: readonly string[],
): SafeHtml {
	const general = scopes.filter((scope) => !APP_SCOPES.has(scope));
	const apps = APPS.map((app) => ({
		...app,
		granted: scopes.filter((scope) => app.scopes.includes(scope)),
	})).filter((app) => app.granted.length > 0);
	return html`${scopeList(i18n, general, "device-scopes")}
${apps.map(
	(app) =>
		html`<p class="label" data-id="device-app-${app.id}">${i18n.t("device.approve.inApp", { app: app.name })}</p>
${scopeList(i18n, app.granted, `device-app-${app.id}-scopes`)}`,
)}
${alertBox("warning", html`<span data-id="device-agent-warning">${i18n.t("device.approve.agentWarning")}</span>`)}`;
}
