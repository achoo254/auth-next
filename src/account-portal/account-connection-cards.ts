import type { AccountDocument } from "../accounts/user-model.js";
import {
	externalAppBadge,
	quotedClientName,
} from "../interactions/client-label.js";
import { describeScopes } from "../interactions/consent-page.js";
import { actionButton, actionLink } from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { accountCard, emptyState } from "./account-card.js";
import { accountIcon } from "./account-icons.js";
import type { AccountView } from "./account-page.js";
import type { AuthorizedApp } from "./grant-directory.js";

/** Confirmation page (GET) and action (POST) of "Remove app access". */
export function appRevokePath(clientId: string): string {
	return `/account/apps/${encodeURIComponent(clientId)}/revoke`;
}

function appRow(view: AccountView, app: AuthorizedApp): SafeHtml {
	const { i18n } = view.page;
	const name = app.firstParty
		? html`<b>${app.name}</b> <span class="badge badge-neutral">${i18n.brand.name}</span>`
		: html`${quotedClientName(i18n, app.name)} ${externalAppBadge(i18n, `app-external-${app.clientId}`)}`;
	return html`<li class="item-row" data-id="app-${app.clientId}">
<div>${name}
${app.redirectHosts.length > 0 ? html`<p class="help">${i18n.t("account.apps.redirects", { hosts: app.redirectHosts.join(", ") })}</p>` : ""}
<p class="help">${describeScopes(i18n, app.scopes).join(" · ")}</p></div>
${actionLink(appRevokePath(app.clientId), i18n.t("account.apps.remove"), { variant: "danger", dataId: `app-revoke-${app.clientId}` })}
</li>`;
}

export function appsCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	return accountCard({
		id: "apps",
		icon: accountIcon("apps"),
		title: i18n.t("account.apps.title"),
		description: i18n.t("account.apps.description"),
		count: view.apps.length,
		body:
			view.apps.length === 0
				? emptyState(i18n.t("account.apps.empty"), "account-apps-empty")
				: html`<ul class="item-list">${view.apps.map((app) => appRow(view, app))}</ul>`,
	});
}

/** "@handle · Name", whatever Telegram told us about the linked chat. */
function telegramLabel(
	telegram: NonNullable<AccountDocument["telegram"]>,
): string {
	const parts = [
		telegram.username ? `@${telegram.username}` : undefined,
		telegram.name,
	].filter((part): part is string => part !== undefined && part !== "");
	return parts.length > 0 ? parts.join(" · ") : `chat ${telegram.chatId}`;
}

function telegramBody(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	if (!view.telegramEnabled) {
		return emptyState(i18n.t("account.telegram.off"), "account-telegram-off");
	}
	const linked = view.account.telegram;
	if (!linked) {
		return html`${emptyState(i18n.t("account.telegram.empty"), "telegram-status")}
${actionButton("/account/telegram/link", view.csrf, i18n.t("account.telegram.link"), { dataId: "telegram-link" })}`;
	}
	return html`<p class="help" data-id="telegram-status">${i18n.rich(
		"account.telegram.linked",
		{
			chat: html`<b>${telegramLabel(linked)}</b>`,
			date: i18n.date(linked.linkedAt),
		},
	)}</p>
${actionButton("/account/telegram/unlink", view.csrf, i18n.t("account.telegram.unlink"), { dataId: "telegram-unlink" })}`;
}

export function telegramCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const status = !view.telegramEnabled
		? i18n.t("account.telegram.statusOff")
		: view.account.telegram
			? i18n.t("account.telegram.statusLinked")
			: i18n.t("account.telegram.statusNone");
	return accountCard({
		id: "telegram",
		icon: accountIcon("telegram"),
		title: "Telegram",
		description: i18n.t("account.telegram.description"),
		count: status,
		body: telegramBody(view),
	});
}
