import { accountCard } from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import {
	UPSTREAM_LABELS,
	upstreamCallbackPath,
} from "../accounts/upstream-client.js";
import type { UpstreamProvider } from "../accounts/user-model.js";
import { UPSTREAM_PROVIDERS } from "../accounts/user-model.js";
import type { MessageKey } from "../i18n/dictionaries.js";
import { PRIVACY_PATH } from "../legal/privacy-page.js";
import {
	actionButton,
	alertBox,
	csrfField,
	inputField,
	pageTitle,
	submitButton,
} from "../ui/components.js";
import { type SafeHtml, html } from "../ui/html.js";
import { renderPage } from "../ui/layout.js";
import type { PageContext } from "../ui/page-context.js";
import type { TenantDocument } from "./tenant-registry.js";
import { appHostsFor } from "./tenant.js";

export interface AdminView {
	readonly page: PageContext;
	readonly csrf: string;
	readonly tenant: TenantDocument;
	/** Client ids of the configured OAuth apps (never their secrets). */
	readonly oauth: Readonly<Partial<Record<UpstreamProvider, string>>>;
	readonly dnsConfigured: boolean;
	readonly dnsAvailable: boolean;
	readonly telegramUsername?: string;
	readonly result?: {
		readonly tone: "success" | "error";
		readonly text: string;
	};
}

function issuerOf(tenant: TenantDocument): string {
	return `https://${appHostsFor(tenant.domain).auth}`;
}

function certificateLine(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	const certificate = view.tenant.certificate;
	if (!certificate) return html``;
	const text =
		certificate.status === "issued"
			? i18n.t("admin.certificate.issued", {
					date: i18n.date(certificate.issuedAt),
				})
			: certificate.status === "failed"
				? i18n.t("admin.certificate.failed", {
						error: certificate.lastError ?? "",
						date: i18n.date(certificate.nextAttemptAt),
					})
				: i18n.t("admin.certificate.pending");
	return html`<p class="help" data-id="admin-certificate">${text}</p>`;
}

function overview(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	const hosts = appHostsFor(view.tenant.domain);
	const status: MessageKey =
		view.tenant.status === "active"
			? "admin.status.active"
			: "admin.status.claimed";
	return html`${alertBox(view.tenant.status === "active" ? "success" : "warning", i18n.t(status, { issuer: issuerOf(view.tenant) }))}
<p class="label">${i18n.t("admin.hosts.title")}</p>
<p class="help">${Object.values(hosts).map((host) => html`<code class="mono">${host}</code> `)}</p>
${certificateLine(view)}`;
}

function nameForm(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	return html`<form method="post" action="/admin/name" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "displayName", label: i18n.t("admin.name.title"), value: view.tenant.displayName, maxlength: 40, help: i18n.t("admin.name.help") })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-name" })}</form>`;
}

function oauthForm(view: AdminView, provider: UpstreamProvider): SafeHtml {
	const { i18n } = view.page;
	const label = UPSTREAM_LABELS[provider];
	const callback = `${issuerOf(view.tenant)}${upstreamCallbackPath(provider)}`;
	const clientId = view.oauth[provider];
	return html`<p class="help">${i18n.rich("admin.oauth.help", { provider: label, callback: html`<code class="mono" data-id="admin-callback-${provider}">${callback}</code>` })}</p>
${provider === "google" ? html`<p class="help">${i18n.rich("admin.oauth.googlePrivacy", { url: html`<code class="mono">${issuerOf(view.tenant)}${PRIVACY_PATH}</code>` })}</p>` : ""}
${clientId ? html`<p class="help" data-id="admin-oauth-${provider}-configured">${i18n.t("admin.oauth.configured", { clientId })}</p>` : ""}
<form method="post" action="/admin/oauth/${provider}" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "clientId", id: `f-${provider}-client-id`, label: i18n.t("admin.oauth.clientId"), autocomplete: "off", maxlength: 200 })}
${inputField({ name: "clientSecret", id: `f-${provider}-client-secret`, label: i18n.t("admin.oauth.clientSecret"), type: "password", autocomplete: "off", maxlength: 200 })}
${submitButton(i18n.t("admin.save"), { dataId: `admin-save-${provider}` })}</form>
${clientId ? actionButton(`/admin/oauth/${provider}/remove`, view.csrf, i18n.t("admin.oauth.remove"), { variant: "danger", dataId: `admin-remove-${provider}` }) : ""}`;
}

function dnsForm(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	if (!view.dnsAvailable)
		return html`<p class="help">${i18n.t("admin.dns.unavailable")}</p>`;
	return html`${view.dnsConfigured ? html`<p class="help" data-id="admin-dns-configured">${i18n.t("admin.dns.configured")}</p>` : ""}
<form method="post" action="/admin/dns" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "token", id: "f-dns-token", label: i18n.t("admin.dns.token"), type: "password", autocomplete: "off", maxlength: 200 })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-dns" })}</form>`;
}

function telegramForm(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	return html`${view.telegramUsername ? html`<p class="help" data-id="admin-telegram-configured">${i18n.t("admin.telegram.configured", { username: view.telegramUsername })}</p>` : ""}
<form method="post" action="/admin/telegram" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "token", id: "f-telegram-token", label: i18n.t("admin.telegram.token"), type: "password", autocomplete: "off", maxlength: 200 })}
${inputField({ name: "username", id: "f-telegram-username", label: i18n.t("admin.telegram.username"), autocomplete: "off", maxlength: 33 })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-telegram" })}</form>`;
}

/** A tenant's /admin, for its owner only (the route checks the session). */
export function renderAdminPage(view: AdminView): string {
	const { i18n } = view.page;
	const { domain } = view.tenant;
	const cards = [
		accountCard({
			id: "admin-name",
			icon: accountIcon("profile"),
			title: i18n.t("admin.name.title"),
			description: i18n.t("admin.name.help"),
			body: nameForm(view),
		}),
		...UPSTREAM_PROVIDERS.map((provider) =>
			accountCard({
				id: `admin-${provider}`,
				icon: accountIcon("signIn"),
				title: i18n.t("admin.oauth.title", {
					provider: UPSTREAM_LABELS[provider],
				}),
				description: i18n.t("admin.status.claimed"),
				body: oauthForm(view, provider),
			}),
		),
		accountCard({
			id: "admin-dns",
			icon: accountIcon("devices"),
			title: i18n.t("admin.dns.title"),
			description: i18n.t("admin.dns.help", { domain }),
			body: dnsForm(view),
		}),
		accountCard({
			id: "admin-telegram",
			icon: accountIcon("telegram"),
			title: i18n.t("admin.telegram.title"),
			description: i18n.t("admin.telegram.help"),
			body: telegramForm(view),
		}),
	];
	const body = html`${pageTitle(i18n.t("admin.title"), i18n.t("admin.lead", { domain }))}
${view.result ? alertBox(view.result.tone, view.result.text) : ""}
${overview(view)}
<div class="account-grid">${cards}</div>
<form method="post" action="/admin/sign-out" class="inline-form">${csrfField(view.csrf)}${submitButton(i18n.t("admin.signOut"), { variant: "minimal", dataId: "admin-sign-out" })}</form>`;
	return renderPage({
		title: i18n.t("admin.title"),
		host: appHostsFor(domain).auth,
		page: view.page,
		layout: "portal",
		body,
	});
}
