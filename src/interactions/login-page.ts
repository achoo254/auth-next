import { UPSTREAM_LABELS } from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import type { Translator } from "../i18n/translator.js";
import {
	alertBox,
	csrfField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import { providerLogo } from "../ui/provider-logos.js";
import { clientLabel } from "./client-label.js";
import { reviewLoginLink } from "./review-login-page.js";

/**
 * "Sign in with Google" style buttons, each with its provider's mark, or
 * the unavailable notice when none is configured (the only ways in). The
 * Apple button follows Apple's guidelines: solid, black on light pages and
 * white on dark ones, the same size as the others and listed first.
 */
export function upstreamButtons(
	i18n: Translator,
	uid: string,
	providers: readonly UpstreamProvider[],
	verb: Extract<MessageKey, "login.with" | "signup.with">,
): SafeHtml {
	if (providers.length === 0) {
		return html`<div data-id="upstream-unavailable">${alertBox("error", i18n.t("login.noProvider"))}</div>`;
	}
	return html`<div class="oauth">${providers.map(
		(provider) =>
			html`<a class="btn ${provider === "apple" ? "btn-apple" : "btn-secondary"} btn-block btn-provider" href="/interaction/${uid}/upstream/${provider}" data-id="upstream-${provider}">${providerLogo(provider)}<span>${i18n.t(verb, { provider: UPSTREAM_LABELS[provider] })}</span></a>`,
	)}</div>`;
}

export interface LoginView {
	readonly page: PageContext;
	readonly uid: string;
	readonly csrf: string;
	readonly providers: readonly UpstreamProvider[];
	/** Who is asking: an app name, or a device approval. */
	readonly clientName?: string;
	/** The app registered through DCR: its name is self-declared. */
	readonly externalClient?: boolean;
	readonly forDevice: boolean;
	/** Offer the review-only sign-in (ADR 0010) under the buttons. */
	readonly reviewLogin?: boolean;
}

/**
 * Title and subtitle: a first-party app is named in the title ("Sign in
 * to continue to Localman"); an external app keeps its quoted, labelled
 * name in the subtitle.
 */
function loginHeading(view: LoginView): SafeHtml {
	const { i18n } = view.page;
	const tagline = i18n.t("login.tagline");
	if (view.forDevice) {
		return pageTitle(i18n.t("login.title"), i18n.t("login.forDevice"));
	}
	if (!view.clientName) return pageTitle(i18n.t("login.title"), tagline);
	if (view.externalClient) {
		return pageTitle(
			i18n.t("login.title"),
			html`${i18n.rich("login.continueTo", {
				app: clientLabel(i18n, view.clientName, true),
			})} ${tagline}`,
		);
	}
	return pageTitle(
		html`<span data-id="login-app-title">${i18n.t("login.titleForApp", { app: view.clientName })}</span>`,
		tagline,
	);
}

export function renderLogin(view: LoginView): string {
	const { i18n } = view.page;
	const body = html`${loginHeading(view)}
<div class="auth-form">
${upstreamButtons(i18n, view.uid, view.providers, "login.with")}
</div>
${view.providers.length > 0 ? html`<p class="auth-foot" data-id="login-first-time">${i18n.t("login.firstTime")}</p>` : ""}
${view.reviewLogin ? reviewLoginLink(i18n, view.uid) : ""}
<form method="post" action="/interaction/${view.uid}/abort" class="auth-cancel">${csrfField(view.csrf)}${submitButton(i18n.t("login.cancel"), { variant: "minimal", dataId: "login-cancel" })}</form>`;
	return renderPage({
		title: i18n.t("login.title"),
		body,
		page: view.page,
	});
}

export interface SignupView {
	readonly page: PageContext;
	readonly uid: string;
	readonly providers: readonly UpstreamProvider[];
}

/** `prompt=create`: the same Google/GitHub/Apple choice, worded as a sign-up. */
export function renderSignup(view: SignupView): string {
	const { i18n } = view.page;
	const body = html`${pageTitle(i18n.t("signup.title"), i18n.t("signup.subtitle"))}
<div class="auth-form">
${upstreamButtons(i18n, view.uid, view.providers, "signup.with")}
</div>
<p class="auth-foot">${i18n.rich("signup.haveAccount", {
		link: html`<a class="link" href="/interaction/${view.uid}/login" data-id="signup-to-login">${i18n.t("login.title")}</a>`,
	})}</p>`;
	return renderPage({
		title: i18n.t("signup.pageTitle"),
		body,
		page: view.page,
	});
}
