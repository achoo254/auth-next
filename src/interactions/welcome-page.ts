import { appIcon } from "../app-directory/app-marks.js";
import { OPTIONAL_WEB_APPS } from "../app-directory/apps-catalog.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Tenant } from "../tenants/tenant.js";
import { csrfField, pageTitle, submitButton } from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";

type HeroKey = "tuvi" | "miu" | "webnhanh";

/** The apps a new account is invited to try, in this order, with their one-line benefit. */
const HERO_APPS: readonly {
	readonly key: HeroKey;
	readonly benefit: MessageKey;
}[] = [
	{ key: "tuvi", benefit: "welcome.benefit.tuvi" },
	{ key: "miu", benefit: "welcome.benefit.miu" },
	{ key: "webnhanh", benefit: "welcome.benefit.webnhanh" },
];

export interface HeroApp {
	readonly key: HeroKey;
	readonly name: string;
	readonly tone: (typeof OPTIONAL_WEB_APPS)[number]["tone"];
	readonly icon: (typeof OPTIONAL_WEB_APPS)[number]["icon"];
	readonly benefit: MessageKey;
	readonly href: string;
}

/** The hero apps this tenant has configured (an app without its URL is left out). */
export function heroApps(tenant: Pick<Tenant, "webApps">): HeroApp[] {
	return HERO_APPS.flatMap(({ key, benefit }) => {
		const href = tenant.webApps[key];
		const app = OPTIONAL_WEB_APPS.find((entry) => entry.key === key);
		if (!href || !app) return [];
		return [
			{ key, name: app.name, tone: app.tone, icon: app.icon, benefit, href },
		];
	});
}

export interface WelcomeView {
	readonly page: PageContext;
	readonly uid: string;
	readonly csrf: string;
	readonly apps: readonly HeroApp[];
	/** The app the sign-in continues to; undefined gives a neutral "Continue". */
	readonly clientName?: string;
}

/**
 * Shown once, right after a new account is created, before the sign-in
 * returns to the app: the ecosystem's hero apps (each opens in a new tab)
 * and one button that finishes the sign-in.
 */
export function renderWelcome(view: WelcomeView): string {
	const { i18n } = view.page;
	const title = i18n.t("welcome.title");
	const continueLabel = view.clientName
		? i18n.t("welcome.continueTo", { app: view.clientName })
		: i18n.t("welcome.continue");
	const body = html`${pageTitle(title, i18n.t("welcome.subtitle"))}
<ul class="welcome-apps" data-id="welcome-apps">${view.apps.map(
		(app) =>
			html`<li class="welcome-app tone-${app.tone}" data-id="welcome-app-${app.key}"><a class="welcome-app-link" href="${app.href}" target="_blank" rel="noopener noreferrer" data-id="welcome-open-${app.key}">
<span class="welcome-app-icon">${appIcon(app.icon, { size: 40 })}</span>
<span class="welcome-app-text"><span class="welcome-app-name">${app.name}</span><span class="welcome-app-benefit">${i18n.t(app.benefit)}</span></span>
<span class="welcome-app-open">${i18n.t("welcome.open")}<span class="shell-sr-only"> ${i18n.t("welcome.newTab")}</span></span>
</a></li>`,
	)}</ul>
<form class="auth-form" method="post" action="/interaction/${view.uid}/welcome">
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
