import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import {
	alertBox,
	csrfField,
	inputField,
	maybeAlert,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";

interface UpstreamPageBase {
	readonly host: string;
	readonly page: PageContext;
	readonly uid: string;
	readonly csrf: string;
	readonly provider: UpstreamProvider;
	readonly email: string;
	/** Already in the page's language. */
	readonly error?: string;
}

/** New account through Google/GitHub: only the username is left to choose. */
export function renderChooseUsername(
	view: UpstreamPageBase & {
		readonly suggestion: string;
		/** An unverified account holds this email and will lose it. */
		readonly reclaiming: boolean;
	},
): string {
	const { i18n } = view.page;
	const provider = UPSTREAM_LABELS[view.provider];
	const title = i18n.t("username.title");
	const body = html`${pageTitle(title, i18n.rich("username.subtitle", { provider, email: html`<b>${view.email}</b>` }))}
${maybeAlert("error", view.error)}
${
	view.reclaiming
		? alertBox(
				"warning",
				i18n.rich("username.reclaimWarning", {
					provider,
					link: html`<a class="link" href="/interaction/${view.uid}">${i18n.t("username.reclaimLink")}</a>`,
				}),
			)
		: ""
}
<form class="auth-form" method="post" action="/interaction/${view.uid}/upstream/signup" novalidate>
${csrfField(view.csrf)}
${inputField({ name: "username", label: i18n.t("username.label"), value: view.suggestion, autocomplete: "username", minlength: 3, maxlength: 30, pattern: "[a-z0-9_]{3,30}", autofocus: true, help: i18n.t("username.help") })}
${submitButton(i18n.t("username.submit"), { block: true, dataId: "upstream-signup-submit" })}
</form>
<p class="auth-foot"><a class="link" href="/interaction/${view.uid}" data-id="upstream-signup-back">${i18n.t("username.back")}</a></p>`;
	return renderPage({ title, body, host: view.host, page: view.page });
}

/** A username guess from the email's local part, e.g. "Minh.Anh" → "minh_anh". */
export function suggestUsername(email: string): string {
	const local = email.split("@")[0] ?? "";
	const cleaned = local
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 30);
	return cleaned.length >= 3 ? cleaned : `${cleaned}_user`.slice(0, 30);
}
