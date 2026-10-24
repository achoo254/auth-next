import { accountCard } from "../account-portal/account-card.js";
import { accountIcon } from "../account-portal/account-icons.js";
import { csrfField, inputField, submitButton } from "../ui/components.js";
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
import { appHostsFor } from "./tenant.js";

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

/** The display name people see, edited beside the addresses. */
function nameForm(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	return html`<form method="post" action="/admin/name" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "displayName", label: i18n.t("admin.name.title"), value: view.tenant.displayName, maxlength: 40, help: i18n.t("admin.name.help") })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-name" })}</form>`;
}

/**
 * The domain across the whole row: active or not, its addresses and
 * certificates on one side, the name people see on the other.
 */
export function domainCard(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	const active = view.tenant.status === "active";
	const hosts = Object.values(appHostsFor(view.tenant.domain));
	return accountCard({
		id: "admin-domain",
		icon: accountIcon("globe"),
		title: view.tenant.domain,
		description: i18n.t(
			active ? "admin.status.active" : "admin.status.claimed",
			{ issuer: issuerOf(view.tenant) },
		),
		state: active
			? { tone: "success", label: i18n.t("admin.state.active") }
			: { tone: "warning", label: i18n.t("admin.state.inactive") },
		wide: true,
		body: html`<div class="admin-split">
<div class="admin-split-part"><div class="field"><p class="label">${i18n.t("admin.hosts.title")}</p>
<ul class="admin-hosts">${hosts.map((host) => html`<li>${copyValue(host)}</li>`)}</ul></div>
${certificateLine(view)}
${replaceDisclosure(i18n.t("admin.hosts.proxyTitle"), html`<p class="help">${i18n.t("admin.hosts.help")}</p>`, "admin-hosts-proxy")}</div>
<div class="admin-split-part" data-id="account-admin-name">${nameForm(view)}</div>
</div>`,
	});
}

export function dnsCard(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	const { domain } = view.tenant;
	const form = html`${setupSteps([
		i18n.t("admin.dns.step1"),
		i18n.t("admin.dns.step2", { domain }),
		i18n.t("admin.dns.step3"),
	])}
<form method="post" action="/admin/dns" class="admin-inline-form">${csrfField(view.csrf)}
${inputField({ name: "token", id: "f-dns-token", label: i18n.t("admin.dns.token"), type: "password", autocomplete: "off", maxlength: 200 })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-dns" })}</form>`;
	const body = !view.dnsAvailable
		? html`<p class="help">${i18n.t("admin.dns.unavailable")}</p>`
		: view.dnsConfigured
			? html`<p class="help" data-id="admin-dns-configured">${i18n.t("admin.dns.configured")}</p>
${replaceDisclosure(i18n.t("admin.dns.change"), form, "admin-dns-change", reopenAfterError(view))}`
			: form;
	return accountCard({
		id: "admin-dns",
		icon: accountIcon("certificate"),
		title: i18n.t("admin.dns.title"),
		description: i18n.t("admin.dns.help", { domain }),
		state: !view.dnsAvailable
			? undefined
			: view.dnsConfigured
				? { tone: "success", label: i18n.t("admin.state.saved") }
				: { tone: "neutral", label: i18n.t("admin.state.notSet") },
		body,
	});
}

export function telegramCard(view: AdminView): SafeHtml {
	const { i18n } = view.page;
	const username = view.telegramUsername;
	const form = html`<p class="help">${i18n.t("admin.telegram.steps")}</p>
<form method="post" action="/admin/telegram" class="auth-form">${csrfField(view.csrf)}
${inputField({ name: "token", id: "f-telegram-token", label: i18n.t("admin.telegram.token"), type: "password", autocomplete: "off", maxlength: 200 })}
${inputField({ name: "username", id: "f-telegram-username", label: i18n.t("admin.telegram.username"), autocomplete: "off", maxlength: 33 })}
${submitButton(i18n.t("admin.save"), { dataId: "admin-save-telegram" })}</form>`;
	return accountCard({
		id: "admin-telegram",
		icon: accountIcon("telegram"),
		title: i18n.t("admin.telegram.title"),
		description: i18n.t("admin.telegram.help"),
		state: username
			? { tone: "success", label: i18n.t("admin.state.connected") }
			: { tone: "neutral", label: i18n.t("admin.state.optional") },
		body: username
			? html`${savedValue(i18n.t("admin.telegram.username"), html`<code class="mono" data-id="admin-telegram-configured">@${username}</code>`)}
${replaceDisclosure(i18n.t("admin.telegram.change"), form, "admin-telegram-change", reopenAfterError(view))}`
			: form,
	});
}
