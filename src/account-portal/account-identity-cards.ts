import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import {
	UPSTREAM_PROVIDERS,
	type UpstreamProvider,
	usableSignInProviders,
} from "../accounts/user-model.js";
import {
	actionButton,
	csrfField,
	inputField,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { providerLogo } from "../ui/provider-logos.js";
import { accountCard, emptyState } from "./account-card.js";
import { accountIcon } from "./account-icons.js";
import type { AccountView } from "./account-page.js";

export function profileCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const name = view.account.name;
	return accountCard({
		id: "profile",
		icon: accountIcon("profile"),
		title: i18n.t("account.profile.title"),
		description: i18n.t("account.profile.description"),
		body: html`${name ? "" : emptyState(i18n.t("account.profile.empty", { username: view.account.username }), "account-profile-empty")}
<form class="auth-form" method="post" action="/account/profile">${csrfField(view.csrf)}
${inputField({ name: "name", label: i18n.t("account.profile.nameLabel"), value: name ?? "", maxlength: 100, required: false })}
${submitButton(i18n.t("account.profile.save"), { variant: "secondary", dataId: "profile-save" })}</form>`,
	});
}

/** "email · @login" a provider vouched for, or "unknown" for older links. */
function providerIdentity(
	view: AccountView,
	provider: UpstreamProvider,
): string {
	const detail = view.account.providerDetails?.[provider];
	const parts = [
		detail?.email,
		detail?.login ? `@${detail.login}` : undefined,
	].filter((part): part is string => Boolean(part));
	return parts.length > 0
		? parts.join(" · ")
		: view.page.i18n.t("common.unknown");
}

/** Unlinking needs another linked provider that can sign in here. */
function isOnlyWayIn(view: AccountView, provider: UpstreamProvider): boolean {
	return (
		usableSignInProviders(view.account, view.providers).filter(
			(other) => other !== provider,
		).length === 0
	);
}

function providerStatus(view: AccountView, provider: UpstreamProvider): string {
	const { i18n } = view.page;
	const identity = providerIdentity(view, provider);
	if (isOnlyWayIn(view, provider)) {
		return i18n.t("account.signIn.linkedOnly", { identity });
	}
	return view.providers.includes(provider)
		? i18n.t("account.signIn.linked", { identity })
		: i18n.t("account.signIn.linkedOff", { identity });
}

function providerRow(view: AccountView, provider: UpstreamProvider): SafeHtml {
	const { i18n } = view.page;
	const label = html`<span class="provider-name">${providerLogo(provider)}<b>${UPSTREAM_LABELS[provider]}</b></span>`;
	const enabled = view.providers.includes(provider);
	if (view.account.providers[provider] === undefined) {
		const link = enabled
			? actionButton(
					`/account/link/${provider}`,
					view.csrf,
					i18n.t("account.signIn.link", {
						provider: UPSTREAM_LABELS[provider],
					}),
					{ dataId: `provider-link-${provider}` },
				)
			: html``;
		return html`<li class="item-row" data-id="provider-${provider}"><div>${label}
<p class="help">${i18n.t("account.signIn.notLinked")}</p></div>${link}</li>`;
	}
	const unlink = isOnlyWayIn(view, provider)
		? html``
		: actionButton(
				`/account/unlink/${provider}`,
				view.csrf,
				i18n.t("account.signIn.unlink", {
					provider: UPSTREAM_LABELS[provider],
				}),
				{ dataId: `provider-unlink-${provider}` },
			);
	return html`<li class="item-row" data-id="provider-${provider}"><div>${label}
<p class="help">${providerStatus(view, provider)}</p></div>${unlink}</li>`;
}

/** Configured providers plus any already linked (even if switched off). */
function shownProviders(view: AccountView): readonly UpstreamProvider[] {
	return UPSTREAM_PROVIDERS.filter(
		(provider) =>
			view.providers.includes(provider) ||
			view.account.providers[provider] !== undefined,
	);
}

/** "linked/shown", e.g. 1/2: the sign-in card's count and summary tile. */
export function signInCount(view: AccountView): string {
	const shown = shownProviders(view);
	const linked = shown.filter(
		(provider) => view.account.providers[provider] !== undefined,
	);
	return `${linked.length}/${shown.length}`;
}

/**
 * How this account signs in: Google, GitHub and Apple, the only ways in. Shown are
 * the configured providers (to link) plus any already linked, even if its
 * sign-in is switched off now: a linked identity is always visible.
 */
export function signInCard(view: AccountView): SafeHtml {
	const { i18n } = view.page;
	const shown = shownProviders(view);
	return accountCard({
		id: "sign-in",
		icon: accountIcon("signIn"),
		title: i18n.t("account.signIn.title"),
		description: i18n.t("account.signIn.description"),
		count: signInCount(view),
		body:
			shown.length === 0
				? emptyState(i18n.t("account.signIn.empty"), "account-sign-in-empty")
				: html`<ul class="item-list">${shown.map((provider) => providerRow(view, provider))}</ul>`,
	});
}
