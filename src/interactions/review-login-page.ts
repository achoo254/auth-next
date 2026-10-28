import type { Translator } from "../i18n/translator.js";
import {
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";

/** The quiet link under the provider buttons while the review sign-in is on. */
export function reviewLoginLink(i18n: Translator, uid: string): SafeHtml {
	return html`<p class="auth-foot"><a class="link" href="/interaction/${uid}/review" data-id="login-review">${i18n.t("review.link")}</a></p>`;
}

export interface ReviewLoginView {
	readonly page: PageContext;
	readonly uid: string;
	readonly csrf: string;
	/** What was typed, shown again after a failure; never the password. */
	readonly email?: string;
	readonly failed?: boolean;
}

/** Email and password of the app-review demo account (ADR 0010). */
export function renderReviewLogin(view: ReviewLoginView): string {
	const { i18n } = view.page;
	const title = i18n.t("review.title");
	const body = html`${pageTitle(title, i18n.t("review.subtitle"))}
${maybeAlert("error", view.failed ? i18n.t("review.failed") : undefined)}
<form class="auth-form" method="post" action="/interaction/${view.uid}/review">
${csrfField(view.csrf)}
${inputField({ name: "email", label: i18n.t("review.email"), type: "email", value: view.email, autocomplete: "username", maxlength: 254, autofocus: true })}
${inputField({ name: "password", label: i18n.t("review.password"), type: "password", autocomplete: "current-password", maxlength: 256 })}
${submitButton(i18n.t("review.submit"), { block: true, dataId: "review-submit" })}
</form>
<p class="auth-foot"><a class="link" href="/interaction/${view.uid}" data-id="review-back">${i18n.t("username.back")}</a></p>`;
	return renderPage({ title, body, page: view.page });
}
