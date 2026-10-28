import {
	externalAppBadge,
	quotedClientName,
} from "../interactions/client-label.js";
import { describeScopes } from "../interactions/consent-page.js";
import { csrfField, pageTitle, submitButton } from "../ui/components.js";
import { type HtmlValue, type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { describeUserAgent } from "./account-sections.js";
import type { AuthorizedApp } from "./grant-directory.js";
import type { OpenSession } from "./session-directory.js";

interface ConfirmView {
	readonly page: PageContext;
	readonly csrf: string;
	readonly title: string;
	readonly lead: HtmlValue;
	readonly details: HtmlValue;
	/** Where the confirm button posts (the same path as this page). */
	readonly action: string;
	readonly confirmLabel: string;
	readonly variant: "primary" | "danger";
	readonly dataId: string;
	readonly cancelHref: string;
}

/**
 * A page that asks before an action that cannot be undone. The button
 * posts with the portal's CSRF token; the route still checks a recent
 * sign-in before it acts.
 */
function renderConfirmPage(view: ConfirmView): string {
	const { i18n } = view.page;
	const body = html`${pageTitle(html`<span data-id="confirm-title">${view.title}</span>`, view.lead)}
${view.details}
<div class="auth-form">
<form method="post" action="${view.action}">${csrfField(view.csrf)}${submitButton(view.confirmLabel, { block: true, variant: view.variant, dataId: view.dataId })}</form>
<a class="btn btn-minimal btn-block" href="${view.cancelHref}" data-id="confirm-cancel">${i18n.t("common.cancel")}</a>
</div>`;
	return renderPage({
		title: view.title,
		body,
		page: view.page,
	});
}

interface ConfirmBase {
	readonly page: PageContext;
	readonly csrf: string;
	readonly action: string;
}

function appName(page: PageContext, app: AuthorizedApp): SafeHtml {
	return app.firstParty
		? html`<b data-id="confirm-app-name">${app.name}</b>`
		: html`${quotedClientName(page.i18n, app.name, "confirm-app-name")} ${externalAppBadge(page.i18n, "confirm-app-external")}`;
}

/** "Remove app access?": the app, what it can do now, what removal does. */
export function renderRemoveAppConfirm(
	view: ConfirmBase & { readonly app: AuthorizedApp },
): string {
	const { i18n } = view.page;
	const scopes = describeScopes(i18n, view.app.scopes);
	return renderConfirmPage({
		...view,
		title: i18n.t("confirm.app.title"),
		lead: i18n.rich("confirm.app.lead", { app: appName(view.page, view.app) }),
		details: html`${
			scopes.length > 0
				? html`<p class="label">${i18n.t("confirm.app.canNow")}</p>
<ul class="scope-list" data-id="confirm-app-scopes">${scopes.map((text) => html`<li>${text}</li>`)}</ul>`
				: ""
		}
<p class="help">${i18n.t("confirm.app.effect")}</p>`,
		confirmLabel: i18n.t("account.apps.remove"),
		variant: "danger",
		dataId: "app-revoke-confirm",
		cancelHref: "/account#account-apps",
	});
}

/** "Sign out every other session?": the sessions that will end. */
export function renderRevokeOthersConfirm(
	view: ConfirmBase & { readonly others: readonly OpenSession[] },
): string {
	const { i18n } = view.page;
	return renderConfirmPage({
		...view,
		title: i18n.t("confirm.sessions.title"),
		lead: i18n.t("confirm.sessions.lead"),
		details: html`<ul class="item-list confirm-list" data-id="confirm-sessions">${view.others.map(
			(session) =>
				html`<li class="item-row"><div><b>${describeUserAgent(i18n, session.userAgent)}</b>
<p class="help">${i18n.t("account.sessions.signedInAt", { date: i18n.date(session.loginAt) })}${session.ip ? html` · IP <code>${session.ip}</code>` : ""}</p></div></li>`,
		)}</ul>
<p class="help">${i18n.t("confirm.sessions.effect")}</p>`,
		confirmLabel: i18n.t("account.sessions.signOutOthers"),
		variant: "primary",
		dataId: "sessions-revoke-others-confirm",
		cancelHref: "/account#account-sessions",
	});
}
