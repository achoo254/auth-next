import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import { BOTS_ADMIN_SCOPE, CREDENTIALS_SCOPE } from "../oidc/resources.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { externalAppBadge, quotedClientName } from "./client-label.js";

/** Plain-language meaning of each scope, as shown on consent pages. */
const SCOPE_TEXT: ReadonlyMap<string, MessageKey> = new Map([
	["openid", "scope.openid"],
	["profile", "scope.profile"],
	["email", "scope.email"],
	["offline_access", "scope.offlineAccess"],
	["telegram", "scope.telegram"],
	["mock:read", "scope.mockRead"],
	["mock:write", "scope.mockWrite"],
	["client:read", "scope.clientRead"],
	["client:write", "scope.clientWrite"],
	["client:send", "scope.clientSend"],
	[CREDENTIALS_SCOPE, "scope.credentialsWrite"],
	["tunnels:open", "scope.tunnelsOpen"],
	["tunnels:read", "scope.tunnelsRead"],
	["chat:read", "scope.chatRead"],
	["chat:write", "scope.chatWrite"],
	["bots:read", "scope.botsRead"],
	["bots:write", "scope.botsWrite"],
	[BOTS_ADMIN_SCOPE, "scope.botsAdmin"],
	["scribe:read", "scope.scribeRead"],
]);

/**
 * Sensitive scopes, each shown with its own red warning under the list:
 * no client holds them by default, a DCR client must declare them.
 */
const SCOPE_WARNINGS: readonly {
	readonly scope: string;
	readonly text: MessageKey;
	readonly dataId: string;
}[] = [
	{
		scope: CREDENTIALS_SCOPE,
		text: "consent.credentialsWarning",
		dataId: "consent-credentials-warning",
	},
	{
		scope: BOTS_ADMIN_SCOPE,
		text: "consent.botsAdminWarning",
		dataId: "consent-bots-admin-warning",
	},
];

function scopeWarnings(
	i18n: Translator,
	scopes: readonly string[],
): SafeHtml[] {
	return SCOPE_WARNINGS.filter(({ scope }) => scopes.includes(scope)).map(
		({ text, dataId }) =>
			alertBox("error", html`<span data-id="${dataId}">${i18n.t(text)}</span>`),
	);
}

export function describeScopes(
	i18n: Translator,
	scopes: readonly string[],
): string[] {
	return [...new Set(scopes)].map((scope) => {
		const key = SCOPE_TEXT.get(scope);
		return key ? i18n.t(key) : i18n.t("scope.unknown", { scope });
	});
}

export interface ConsentView {
	readonly page: PageContext;
	readonly csrf: string;
	readonly uid: string;
	readonly clientName: string;
	/** Registered through DCR: its name is self-declared, nobody vouched for it. */
	readonly external: boolean;
	/** An external app whose name reads like a first-party one. */
	readonly imitatesFirstParty: boolean;
	/** Host of the redirect_uri of this request: where the code is sent. */
	readonly redirectHost: string | undefined;
	readonly scopes: readonly string[];
	readonly username: string;
}

function clientBlock(view: ConsentView): SafeHtml {
	const { i18n } = view.page;
	const name = view.external
		? html`${quotedClientName(i18n, view.clientName, "consent-client-name")} ${externalAppBadge(i18n, "consent-external")}`
		: html`<b data-id="consent-client-name">${view.clientName}</b>`;
	return html`<div class="consent-client" data-id="consent-client">
<p>${name}</p>
${
	view.redirectHost
		? html`<p class="help">${i18n.rich("consent.redirect", { host: html`<code data-id="consent-redirect-host">${view.redirectHost}</code>` })}</p>`
		: ""
}
</div>
${
	view.external
		? alertBox(
				"warning",
				html`<span data-id="consent-external-notice">${i18n.t("consent.externalNotice")}</span>`,
			)
		: ""
}
${
	view.imitatesFirstParty
		? alertBox(
				"error",
				html`<span data-id="consent-lookalike-warning">${i18n.t("consent.lookalikeWarning")}</span>`,
			)
		: ""
}`;
}

/** The consent page: the title names the app asking, unless it is external. */
export function renderConsent(view: ConsentView): string {
	const { i18n } = view.page;
	const title = view.external
		? i18n.t("consent.titleExternal")
		: i18n.t("consent.titleForApp", { app: view.clientName });
	const body = html`${pageTitle(
		html`<span data-id="consent-title">${title}</span>`,
		i18n.rich("common.signedInAs", {
			username: html`<b>@${view.username}</b>`,
		}),
	)}
${clientBlock(view)}
<p class="label">${i18n.t("consent.willBeAbleTo")}</p>
<ul class="scope-list" data-id="consent-scopes">${describeScopes(i18n, view.scopes).map((text) => html`<li>${text}</li>`)}</ul>
${scopeWarnings(i18n, view.scopes)}
<div class="auth-form">
<form method="post" action="/interaction/${view.uid}/consent">${csrfField(view.csrf)}${submitButton(i18n.t("consent.allow"), { block: true, dataId: "consent-allow" })}</form>
<form method="post" action="/interaction/${view.uid}/abort">${csrfField(view.csrf)}${submitButton(i18n.t("consent.deny"), { block: true, variant: "secondary", dataId: "consent-deny" })}</form>
</div>
<p class="help">${i18n.t("consent.revokeHint")}</p>`;
	return renderPage({
		title: i18n.t("consent.pageTitle"),
		body,
		page: view.page,
	});
}
