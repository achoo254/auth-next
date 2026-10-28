import type { MessageKey } from "../i18n/dictionaries.js";
import {
	csrfField,
	inputField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";

/** Asks before deleting; the request comes back here (POST /account/delete). */
export const ACCOUNT_DELETE_PATH = "/account/delete";
/** Where a finished deletion lands; needs no session. */
export const ACCOUNT_DELETED_PATH = "/account/deleted";

interface DeleteConfirmView {
	readonly page: PageContext;
	readonly csrf: string;
	readonly username: string;
}

/**
 * "Delete your account?": what goes, what stays, and the username typed
 * again, so a stray click or a forged form cannot delete an account.
 */
export function renderDeleteConfirm(view: DeleteConfirmView): string {
	const { i18n } = view.page;
	const handle = `@${view.username}`;
	const effects: MessageKey[] = [
		"confirm.delete.signOut",
		"confirm.delete.providers",
		"confirm.delete.appData",
		"confirm.delete.securityLog",
	];
	const title = i18n.t("confirm.delete.title");
	const body = html`${pageTitle(
		html`<span data-id="confirm-title">${title}</span>`,
		i18n.rich("confirm.delete.lead", { username: html`<b>${handle}</b>` }),
	)}
<ul class="scope-list" data-id="confirm-delete-effects">${effects.map((key) => html`<li>${i18n.t(key)}</li>`)}</ul>
<form class="auth-form" method="post" action="${ACCOUNT_DELETE_PATH}">${csrfField(view.csrf)}
${inputField({
	name: "username",
	label: i18n.t("confirm.delete.typeUsername", { username: handle }),
	autocomplete: "off",
	maxlength: 100,
})}
${submitButton(i18n.t("confirm.delete.button"), { block: true, variant: "danger", dataId: "account-delete-confirm" })}
<a class="btn btn-minimal btn-block" href="/account" data-id="confirm-cancel">${i18n.t("common.cancel")}</a>
</form>`;
	return renderPage({ title, body, page: view.page });
}

/** Shown once the account is gone; nothing on it needs a session. */
export function renderAccountDeleted(page: PageContext): string {
	const title = page.i18n.t("deleted.title");
	return renderPage({
		title,
		page,
		body: pageTitle(
			html`<span data-id="account-deleted">${title}</span>`,
			page.i18n.t("deleted.body"),
		),
	});
}
