import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { type SafeHtml, html } from "../ui/html.js";
import { type AccountIcon, accountIcon } from "./account-icons.js";
import { signInCount } from "./account-identity-cards.js";
import type { AccountView } from "./account-page.js";

export type AccountCardId =
	| "profile"
	| "sign-in"
	| "sessions"
	| "devices"
	| "apps"
	| "telegram";

/** The card groups of /account, in page order; the section nav follows it. */
export const ACCOUNT_SECTIONS: readonly {
	readonly group: "account" | "security" | "connections";
	readonly title: MessageKey;
	readonly cards: readonly {
		readonly id: AccountCardId;
		readonly icon: AccountIcon;
		readonly title: MessageKey;
	}[];
}[] = [
	{
		group: "account",
		title: "account.group.account",
		cards: [
			{ id: "profile", icon: "profile", title: "account.profile.title" },
			{ id: "sign-in", icon: "signIn", title: "account.signIn.title" },
		],
	},
	{
		group: "security",
		title: "account.group.security",
		cards: [
			{ id: "sessions", icon: "sessions", title: "account.sessions.title" },
			{ id: "devices", icon: "devices", title: "account.devices.title" },
		],
	},
	{
		group: "connections",
		title: "account.group.connections",
		cards: [
			{ id: "apps", icon: "apps", title: "account.apps.title" },
			{ id: "telegram", icon: "telegram", title: "account.telegram.title" },
		],
	},
];

function emailLine(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const { account } = view;
	if (!account.email) {
		return html`<span data-id="account-email">${i18n.t("account.noEmail")}</span>`;
	}
	const badge = account.emailVerifiedBy
		? html`<span class="badge badge-success" data-id="account-email-verified">${i18n.t("account.emailVerified", { provider: UPSTREAM_LABELS[account.emailVerifiedBy] })}</span>`
		: html`<span class="badge badge-warning" data-id="account-email-unverified">${i18n.t("account.emailUnverified")}</span>`;
	return html`<span data-id="account-email">${account.email}</span> ${badge}`;
}

/** First letter of the display name, else of the username. */
function initial(view: AccountView): string {
	const source = view.account.name?.trim() || view.account.username;
	const [first = "?"] = Array.from(source);
	return first.toLocaleUpperCase(view.page.i18n.locale);
}

function stat(
	href: string,
	value: string | number,
	label: string,
	dataId: string,
): SafeHtml {
	return html`<li><a class="account-stat" href="${href}" data-id="${dataId}"><span class="account-stat-value">${value}</span><span class="account-stat-label">${label}</span></a></li>`;
}

/**
 * Top of /account: who is signed in, sign out, and a count per list that
 * jumps to its card.
 */
export function accountOverview(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const { account } = view;
	return html`<section class="card account-overview" aria-label="${i18n.t("account.overview")}" data-id="account-overview">
<div class="account-overview-main">
<span class="account-avatar" aria-hidden="true">${initial(view)}</span>
<div class="account-overview-text">
<h1 class="account-overview-title">${i18n.t("account.title")}</h1>
<p class="account-overview-name">${account.name ? html`${account.name} · ` : ""}<b data-id="account-username">@${account.username}</b></p>
<p class="help account-anchor" id="account-email">${emailLine(view)}</p>
</div>
<a class="btn btn-secondary account-overview-logout" href="/session/end" data-id="account-logout">${i18n.t("account.signOut")}</a>
</div>
<ul class="account-stats">
${stat("#account-sign-in", signInCount(view), i18n.t("account.stat.signIn"), "stat-sign-in")}
${stat("#account-sessions", view.sessions.length, i18n.t("account.stat.sessions"), "stat-sessions")}
${stat("#account-devices", view.devices.length, i18n.t("account.stat.devices"), "stat-devices")}
${stat("#account-apps", view.apps.length, i18n.t("account.stat.apps"), "stat-apps")}
</ul>
</section>`;
}

/**
 * Section nav: a sticky column beside the cards on wide screens, a row of
 * links that scrolls sideways on phones. Plain anchors, no script.
 */
export function accountNav(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	return html`<nav class="account-nav" aria-label="${i18n.t("account.nav")}" data-id="account-nav">${ACCOUNT_SECTIONS.map(
		(section) =>
			html`<p class="account-nav-group">${i18n.t(section.title)}</p>
<ul class="account-nav-list">${section.cards.map(
				(card) =>
					html`<li><a class="account-nav-link" href="#account-${card.id}" data-id="account-nav-${card.id}">${accountIcon(card.icon)}<span>${i18n.t(card.title)}</span></a></li>`,
			)}</ul>`,
	)}</nav>`;
}
