import type {
	AccountDocument,
	UpstreamProvider,
} from "../accounts/user-model.js";
import { actionLink, alertBox } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { accountCard, accountGroup } from "./account-card.js";
import { appsCard, telegramCard } from "./account-connection-cards.js";
import { ACCOUNT_DELETE_PATH } from "./account-delete-page.js";
import { accountIcon } from "./account-icons.js";
import { profileCard, signInCard } from "./account-identity-cards.js";
import {
	ACCOUNT_SECTIONS,
	type AccountCardId,
	accountNav,
	accountOverview,
} from "./account-overview.js";
import { devicesCard, sessionsCard } from "./account-sections.js";
import type { DeviceGrant } from "./device-grants.js";
import type { AuthorizedApp } from "./grant-directory.js";
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
	/** The tenant lets people delete their own account (ADR 0009). */
	readonly canDelete: boolean;
	readonly notice?: string;
}

const CARDS: Readonly<Record<AccountCardId, (view: AccountView) => SafeHtml>> =
	{
		profile: profileCard,
		"sign-in": signInCard,
		sessions: sessionsCard,
		devices: devicesCard,
		apps: appsCard,
		telegram: telegramCard,
	};

/** Last on the page, outside the groups: the one action with no way back. */
function deleteCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	return accountCard({
		id: "delete",
		icon: accountIcon("delete"),
		title: i18n.t("account.delete.title"),
		description: i18n.t("account.delete.description"),
		body: actionLink(ACCOUNT_DELETE_PATH, i18n.t("account.delete.open"), {
			variant: "danger-outline",
			dataId: "account-delete-open",
		}),
	});
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
 * /account: everything a user can manage about their account. An overview
 * on top, then a section nav beside three groups of cards (account,
 * security, connections), one card under another.
 */
export function renderAccountPage(view: AccountView): string {
	const { i18n } = view.page;
	const groups = ACCOUNT_SECTIONS.map((section) =>
		accountGroup(
			section.group,
			i18n.t(section.title),
			section.cards.map((card) => CARDS[card.id](view)),
		),
	);
	const body = html`${accountOverview(view)}
${alerts(view)}
<div class="account-layout">
${accountNav(view)}
<div class="account-sections">${groups}${view.canDelete ? deleteCard(view) : ""}</div>
</div>`;
	return renderPage({
		title: i18n.t("account.pageTitle"),
		body,
		host: view.host,
		page: view.page,
		layout: "portal",
		stylesheets: ["account.css"],
	});
}
