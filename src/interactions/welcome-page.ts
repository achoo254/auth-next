import {
	CROSS_SELL_FALLBACK,
	crossSellHref,
	crossSellSuggestion,
} from "@achoo254/app-switcher/cross-sell";
import { appIcon } from "../app-directory/app-marks.js";
import { OPTIONAL_WEB_APPS } from "../app-directory/apps-catalog.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Tenant } from "../tenants/tenant.js";
import { csrfField, pageTitle, submitButton } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { appOfClient } from "../usage/usage-apps.js";

type WelcomeAppKey = (typeof OPTIONAL_WEB_APPS)[number]["key"];

/** `utm_medium` of the suggested link (the switcher's is `app_switcher`). */
export const WELCOME_UTM_MEDIUM = "welcome";

/** `utm_campaign` when the account was made on the IdP itself (the /account pages). */
export const WELCOME_UNKNOWN_ORIGIN = "auth";

/**
 * The one line that sells each app the pairing can suggest. Any other app
 * falls back to its line on the app directory.
 */
const PITCHES: Partial<Record<WelcomeAppKey, MessageKey>> = {
	kb: "welcome.pitch.kb",
	chuanho: "welcome.pitch.chuanho",
	clip: "welcome.pitch.clip",
	tuvi: "welcome.pitch.tuvi",
	webnhanh: "welcome.pitch.webnhanh",
	miu: "welcome.pitch.miu",
};

/**
 * The app (its id in the shared cross-sell table) whose sign-in made the
 * account: the growth report's grouping of clients (a DCR client is
 * Localman's MCP); undefined for the IdP's own /account pages.
 */
export function originAppOf(clientId: string | undefined): string | undefined {
	return clientId ? appOfClient(clientId) : undefined;
}

export interface WelcomeSuggestion {
	readonly key: WelcomeAppKey;
	readonly name: string;
	readonly tone: (typeof OPTIONAL_WEB_APPS)[number]["tone"];
	readonly icon: (typeof OPTIONAL_WEB_APPS)[number]["icon"];
	readonly pitch: MessageKey;
	/** The app's address with `utm_source=cross_sell&utm_medium=welcome&utm_campaign=<origin>`. */
	readonly href: string;
}

/**
 * The app suggested to an account made from `clientId`: the shared pairing
 * of @achoo254/app-switcher; when this tenant has not configured that app,
 * the shared fallback (Web Nhanh), then the first configured app. Never
 * the origin app itself; undefined only when no other app is configured.
 */
export function welcomeSuggestion(
	tenant: Pick<Tenant, "webApps">,
	clientId: string | undefined,
): WelcomeSuggestion | undefined {
	const origin = originAppOf(clientId);
	const preferred: readonly string[] = [
		crossSellSuggestion(origin),
		CROSS_SELL_FALLBACK,
		...OPTIONAL_WEB_APPS.map((entry) => entry.key),
	];
	const app = preferred
		.filter((key) => key !== origin)
		.map((key) => OPTIONAL_WEB_APPS.find((entry) => entry.key === key))
		.find((entry) => entry !== undefined && tenant.webApps[entry.key]);
	const address = app ? tenant.webApps[app.key] : undefined;
	if (!app || !address) return undefined;
	return {
		key: app.key,
		name: app.name,
		tone: app.tone,
		icon: app.icon,
		pitch: PITCHES[app.key] ?? app.description,
		href: crossSellHref(
			address,
			origin ?? WELCOME_UNKNOWN_ORIGIN,
			WELCOME_UTM_MEDIUM,
		),
	};
}

export interface WelcomeView {
	readonly page: PageContext;
	readonly uid: string;
	readonly csrf: string;
	readonly suggestion: WelcomeSuggestion;
	/** The app the sign-in returns to; undefined gives a neutral "Continue". */
	readonly clientName?: string | undefined;
}

/**
 * Shown once, right after a new account is created, before the sign-in
 * returns to the app: a short hello, the one app paired with the app the
 * account came from (opens in a new tab), and the button that finishes the
 * sign-in and goes back to that app.
 */
export function renderWelcome(view: WelcomeView): string {
	const { i18n } = view.page;
	const { suggestion: app } = view;
	const title = i18n.t("welcome.title");
	const subtitle = view.clientName
		? i18n.t("welcome.subtitleFrom", { app: view.clientName })
		: i18n.t("welcome.subtitle");
	const continueLabel = view.clientName
		? i18n.t("welcome.continueTo", { app: view.clientName })
		: i18n.t("welcome.continue");
	const body = html`${pageTitle(title, subtitle)}
<div class="welcome-app tone-${app.tone}" data-id="welcome-app-${app.key}"><a class="welcome-app-link" href="${app.href}" target="_blank" rel="noopener noreferrer" data-id="welcome-open-${app.key}">
<span class="welcome-app-icon">${appIcon(app.icon, { size: 40 })}</span>
<span class="welcome-app-text"><span class="welcome-app-tag">${i18n.t("welcome.suggested")}</span><span class="welcome-app-name">${app.name}</span><span class="welcome-app-benefit">${i18n.t(app.pitch)}</span></span>
<span class="welcome-app-open">${i18n.t("welcome.open")}<span class="shell-sr-only"> ${i18n.t("welcome.newTab")}</span></span>
</a></div>
<form class="auth-form welcome-form" method="post" action="/interaction/${view.uid}/welcome">
${csrfField(view.csrf)}
${submitButton(continueLabel, { block: true, dataId: "welcome-continue" })}
</form>`;
	return renderPage({
		title,
		body,
		page: view.page,
		stylesheets: ["apps.css", "welcome.css"],
	});
}
