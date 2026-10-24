import {
	type AccountCardState,
	accountCard,
} from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import {
	UPSTREAM_LABELS,
	upstreamCallbackPath,
} from "../accounts/upstream-client.js";
import type { TenantOAuthProvider } from "../accounts/user-model.js";
import { PRIVACY_PATH } from "../legal/privacy-page.js";
import {
	actionButton,
	csrfField,
	inputField,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import {
	copyValue,
	issuerOf,
	reopenAfterError,
	replaceDisclosure,
	savedValue,
	setupSteps,
} from "./admin-blocks.js";
import type { AdminView } from "./admin-page.js";

/** Whether people sign in with `provider` here, or why not yet. */
function providerStatus(
	view: AdminView,
	provider: TenantOAuthProvider,
): { readonly text: string; readonly state: AccountCardState } {
	const { i18n } = view.page;
	const label = UPSTREAM_LABELS[provider];
	if (view.oauth[provider]) {
		return {
			text: i18n.t("admin.oauth.on", { provider: label }),
			state: { tone: "success", label: i18n.t("admin.state.on") },
		};
	}
	if (view.tenant.status === "active") {
		return {
			text: i18n.t("admin.oauth.off", { provider: label }),
			state: { tone: "neutral", label: i18n.t("admin.state.off") },
		};
	}
	return {
		text: i18n.t("admin.status.claimed"),
		state: { tone: "warning", label: i18n.t("admin.state.notSet") },
	};
}

export function oauthCard(
	view: AdminView,
	provider: TenantOAuthProvider,
): SafeHtml {
	const { i18n } = view.page;
	const label = UPSTREAM_LABELS[provider];
	const issuer = issuerOf(view.tenant);
	const clientId = view.oauth[provider];
	const status = providerStatus(view, provider);
	const steps = [
		html`${i18n.t("admin.oauth.help", { provider: label })} ${copyValue(`${issuer}${upstreamCallbackPath(provider)}`, `admin-callback-${provider}`)}`,
		...(provider === "google"
			? [
					html`${i18n.t("admin.oauth.googlePrivacy")} ${copyValue(`${issuer}${PRIVACY_PATH}`)}`,
				]
			: []),
	];
	const form = html`${setupSteps(steps)}
<form method="post" action="/admin/oauth/${provider}" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "clientId", id: `f-${provider}-client-id`, label: i18n.t("admin.oauth.clientId"), autocomplete: "off", maxlength: 200 })}
${inputField({ name: "clientSecret", id: `f-${provider}-client-secret`, label: i18n.t("admin.oauth.clientSecret"), type: "password", autocomplete: "off", maxlength: 200 })}
${submitButton(i18n.t("admin.save"), { dataId: `admin-save-${provider}` })}</form>`;
	return accountCard({
		id: `admin-${provider}`,
		icon: accountIcon("signIn"),
		title: i18n.t("admin.oauth.title", { provider: label }),
		description: status.text,
		state: status.state,
		body: clientId
			? html`${savedValue(i18n.t("admin.oauth.clientId"), html`<code class="mono" data-id="admin-oauth-${provider}-configured">${clientId}</code>`)}
${replaceDisclosure(i18n.t("admin.oauth.change"), form, `admin-oauth-${provider}-change`, reopenAfterError(view))}`
			: form,
		footer: clientId
			? actionButton(
					`/admin/oauth/${provider}/remove`,
					view.csrf,
					i18n.t("admin.oauth.remove"),
					{ variant: "danger-outline", dataId: `admin-remove-${provider}` },
				)
			: undefined,
	});
}
