import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type {
	AccountDocument,
	UpstreamProvider,
} from "../accounts/user-model.js";
import { alertBox } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { accountGroup } from "./account-card.js";
import { appsCard, telegramCard } from "./account-connection-cards.js";
import { profileCard, signInCard } from "./account-identity-cards.js";
import { devicesCard, sessionsCard } from "./account-sections.js";
import type { AuthorizedApp, DeviceGrant } from "./grant-directory.js";
import { ACCOUNT_NOTICES } from "./notices.js";
import type { OpenSession } from "./session-directory.js";

export interface AccountView {
	readonly host: string;
	readonly page: PageContext;
	readonly csrf: string;
	readonly account: AccountDocument;
	readonly currentSessionUid: string;
	readonly providers: readonly UpstreamProvider[];
	readonly telegramEnabled: boolean;
	readonly sessions: readonly OpenSession[];
	readonly devices: readonly DeviceGrant[];
	readonly apps: readonly AuthorizedApp[];
	readonly notice?: string;
}

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

function header(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const { account } = view;
	return html`<header class="portal-head">
<div class="portal-head-text">
<h1 class="auth-title">${i18n.t("account.title")}</h1>
<p class="auth-sub">${account.name ? html`${account.name} · ` : ""}<b data-id="account-username">@${account.username}</b></p>
<p class="help account-anchor" id="account-email">${emailLine(view)}</p>
</div>
<a class="btn btn-secondary" href="/session/end" data-id="account-logout">${i18n.t("account.signOut")}</a>
</header>`;
}

function alerts(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const notice = view.notice ? ACCOUNT_NOTICES.get(view.notice) : undefined;
	const reclaimed = view.account.reclaimedEmail;
	return html`${
		reclaimed
			? alertBox(
					"warning",
					html`<span data-id="account-email-reclaimed">${i18n.rich("account.emailReclaimed", { email: html`<b>${reclaimed.email}</b>`, date: i18n.date(reclaimed.at) })}</span>`,
				)
			: ""
	}
${notice ? alertBox(notice.tone, i18n.t(notice.text)) : ""}`;
}

/**
 * /account: everything a user can manage about their hoandat account, in
 * three groups of cards (account, security, connections).
 */
export function renderAccountPage(view: AccountView): string {
	const { i18n } = view.page;
	const body = html`${header(view)}
${alerts(view)}
${accountGroup("account", i18n.t("account.group.account"), [profileCard(view), signInCard(view)])}
${accountGroup("security", i18n.t("account.group.security"), [sessionsCard(view), devicesCard(view)])}
${accountGroup("connections", i18n.t("account.group.connections"), [appsCard(view), telegramCard(view)])}`;
	return renderPage({
		title: i18n.t("account.pageTitle"),
		body,
		host: view.host,
		page: view.page,
		layout: "portal",
	});
}
